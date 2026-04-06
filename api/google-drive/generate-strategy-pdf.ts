import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
  driveCopyFile,
  driveDeleteFile,
  driveRequest,
  slidesRequest,
  driveExportPdf,
  driveUploadMultipart,
  normalizeValue,
  positionLabel,
  sanitizeFileName,
  formatDocumentDate,
} from './_lib.js';

// ─── Template IDs by language + website ──────────────────────────────────────
const TEMPLATES = {
  spanish: {
    withWeb:    '1ypgDKkzmEM98Q7tuKF_m7sxdY_oCFZ1v5RMjujBBuOk',
    withoutWeb: '1__jgfwa9uZbD-7BxKwfIWr-wcN-OmEOKM_9hY47ws3Y',
  },
  other: {
    withWeb:    '1mR2T30g5R-qCmJJV5CXTzyQTcZ8DKCydrcle_Kpt2FY',
    withoutWeb: '1K0VEa036zLaYLCn5Ax7z2tuY2MRszTi_dUkUoLjBroE',
  },
} as const;

function getTemplateId(language: string | undefined, hasWebsite: boolean): string {
  const isEnglish = (language ?? '').toLowerCase() === 'english';
  const group = isEnglish ? TEMPLATES.other : TEMPLATES.spanish;
  return hasWebsite ? group.withWeb : group.withoutWeb;
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

function buildChartUrl(labels: string[], data: number[]): string {
  const cfg = JSON.stringify({
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#a4d62c',
        backgroundColor: 'rgba(164,214,44,0.10)',
        fill: true,
        pointRadius: 3,
        borderWidth: 2,
        tension: 0.3,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: false } },
    },
  });
  return `https://quickchart.io/chart?w=700&h=200&bkg=white&c=${encodeURIComponent(cfg)}`;
}

function extractElementText(el: Record<string, unknown>): string {
  const shape = el.shape as Record<string, unknown> | undefined;
  const text  = shape?.text as Record<string, unknown> | undefined;
  const textElements = (text?.textElements as Array<Record<string, unknown>>) ?? [];
  return textElements.map(te => {
    const tr = te.textRun as Record<string, unknown> | undefined;
    return String(tr?.content ?? '');
  }).join('');
}

async function insertTrafficChart(
  copyId: string,
  labels: string[],
  data: number[],
): Promise<{ ok: boolean; error?: string }> {
  const pres = await slidesRequest(`/presentations/${encodeURIComponent(copyId)}`) as Record<string, unknown>;
  const slides = (pres.slides as Array<Record<string, unknown>>) ?? [];

  for (const slide of slides) {
    const pageElements = (slide.pageElements as Array<Record<string, unknown>>) ?? [];
    for (const el of pageElements) {
      if (extractElementText(el).includes('{{EV_TRAFICO}}')) {
        const chartUrl = buildChartUrl(labels, data);
        // Fetch the chart image and upload to Drive so Google Slides can access it reliably
        const imgRes = await fetch(chartUrl);
        if (!imgRes.ok) {
          return { ok: false, error: `QuickChart fetch failed: ${imgRes.status}` };
        }
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        const uploadRes = await driveRequest(
          `https://www.googleapis.com/upload/drive/v3/files?uploadType=media&fields=id`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'image/png' },
            body: imgBuf,
          },
        ) as { id: string };
        const imageFileId = uploadRes.id;
        // Make file public so Slides API can read it
        await driveRequest(`/files/${encodeURIComponent(imageFileId)}/permissions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
        const publicUrl = `https://drive.google.com/uc?export=download&id=${imageFileId}`;
        try {
          await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
            method: 'POST',
            body: JSON.stringify({
              requests: [
                { deleteObject: { objectId: el.objectId } },
                {
                  createImage: {
                    url: publicUrl,
                    elementProperties: {
                      pageObjectId: slide.objectId,
                      size: el.size,
                      transform: el.transform,
                    },
                  },
                },
              ],
            }),
          });
        } finally {
          // Clean up temp Drive file
          await driveRequest(`/files/${encodeURIComponent(imageFileId)}?supportsAllDrives=true`, { method: 'DELETE' }).catch(() => {});
        }
        return { ok: true };
      }
    }
  }
  return { ok: false, error: 'placeholder {{EV_TRAFICO}} not found in any slide element' };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopKeyword { keyword: string; position?: number }
interface StrategyAnalysis {
  top_keywords?: TopKeyword[];
  monthly_visits?: string | number;
  site_speed_score?: string | number;
  technical_health_score?: string | number;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body as {
    templateId?: string;
    businessName?: string;
    websiteUrl?: string;
    language?: string;
    analysis?: StrategyAnalysis;
    trafficGrowthPercent?: string;
    chartLabels?: string[];
    chartData?: number[];
  };

  const businessName = normalizeValue(body.businessName);
  const websiteUrl   = normalizeValue(body.websiteUrl);
  const language     = body.language ?? 'spanish';
  const analysis     = body.analysis || {};
  const topKeywords  = Array.isArray(analysis.top_keywords) ? analysis.top_keywords.slice(0, 5) : [];
  const documentDate = formatDocumentDate();
  const growthPct    = body.trafficGrowthPercent ?? '0';
  const chartLabels  = body.chartLabels ?? [];
  const chartData    = body.chartData ?? [];

  if (topKeywords.length !== 5) {
    res.status(400).json({ error: 'Se requieren exactamente 5 keywords para generar la presentación' });
    return;
  }

  // Template ID: body override > language-based default
  const templateId = body.templateId || getTemplateId(language, true);

  // ── Build replacements ─────────────────────────────────────────────────────
  const replacements = [
    { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName },
    { containsText: { text: '{{URL_SITIO}}',         matchCase: true }, replaceText: websiteUrl },
    { containsText: { text: '{{FECHA_DOCUMENTO}}',   matchCase: true }, replaceText: documentDate },
    { containsText: { text: '{{VISITAS_MES}}',       matchCase: true }, replaceText: normalizeValue(analysis.monthly_visits, '0') },
    { containsText: { text: '{{VELOCIDAD_SCORE}}',   matchCase: true }, replaceText: normalizeValue(analysis.site_speed_score, '0') },
    { containsText: { text: '{{SALUD_TECNICA}}',     matchCase: true }, replaceText: normalizeValue(analysis.technical_health_score, '0') },
    { containsText: { text: '{{POR_CRECIMIENTO}}',   matchCase: true }, replaceText: growthPct },
  ];

  topKeywords.forEach((item, i) => {
    const idx = i + 1;
    replacements.push(
      { containsText: { text: `{{KEYWORD_${idx}}}`,          matchCase: true }, replaceText: normalizeValue(item.keyword) },
      { containsText: { text: `{{KEYWORD_${idx}_POSICION}}`, matchCase: true }, replaceText: positionLabel(item.position) },
    );
  });

  // Fill decorative background keyword placeholders (6..20) cycling through the 5 data keywords
  for (let j = 6; j <= 20; j++) {
    const kw = topKeywords[(j - 1) % topKeywords.length];
    replacements.push(
      { containsText: { text: `{{KEYWORD_${j}}}`,          matchCase: true }, replaceText: normalizeValue(kw.keyword) },
      { containsText: { text: `{{KEYWORD_${j}_POSICION}}`, matchCase: true }, replaceText: positionLabel(kw.position) },
    );
  }

  // ── Copy → modify → export → delete ───────────────────────────────────────
  const timestamp    = new Date().toISOString().slice(0, 10);
  const fileName     = `${sanitizeFileName(`Estrategia SEO - ${businessName} - ${timestamp}`)}.pdf`;
  const outputFolderId = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID;
  const copy         = await driveCopyFile(templateId, `_tmp_${Date.now()}`, outputFolderId || undefined);
  const copyId       = copy.id;

  let pdfBuffer: Buffer;
  let chartError: string | undefined;
  try {
    // 1. Text replacements
    await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: replacements.map(r => ({ replaceAllText: r })) }),
    });

    // 2. {{EV_TRAFICO}}: insert chart image if we have data, otherwise clear the placeholder
    if (chartLabels.length && chartData.length) {
      const chartResult = await insertTrafficChart(copyId, chartLabels, chartData).catch(
        (e: unknown) => ({ ok: false, error: String(e) }),
      );
      if (!chartResult.ok) {
        chartError = chartResult.error;
        await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: '{{EV_TRAFICO}}', matchCase: true }, replaceText: '' } }] }),
        }).catch(() => {});
      }
    } else {
      // No traffic history available → clear placeholder so it doesn't show in PDF
      await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: '{{EV_TRAFICO}}', matchCase: true }, replaceText: '' } }] }),
      }).catch(() => {});
    }

    // 3. Export PDF
    pdfBuffer = await driveExportPdf(copyId);
  } finally {
    await driveDeleteFile(copyId).catch(() => {});
  }

  try {
    if (outputFolderId) {
      const uploaded = await driveUploadMultipart(
        { name: fileName, parents: [outputFolderId] },
        pdfBuffer,
        'application/pdf',
      );
      res.status(200).json({
        success: true,
        fileName,
        localPath: uploaded.webViewLink,
        driveUrl: uploaded.webViewLink,
        driveFileId: uploaded.id,
        ...(chartError ? { chartError } : {}),
      });
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-File-Name', fileName);
      if (chartError) res.setHeader('X-Chart-Error', chartError.slice(0, 200));
      res.status(200).send(pdfBuffer);
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
