import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
  driveRequest,
  slidesRequest,
  driveExportPdf,
  driveUploadMultipart,
  normalizeValue,
  positionLabel,
  sanitizeFileName,
  formatDocumentDate,
} from './_lib.js';

interface TopKeyword { keyword: string; position?: number }
interface StrategyAnalysis {
  top_keywords?: TopKeyword[];
  monthly_visits?: string | number;
  site_speed_score?: string | number;
  technical_health_score?: string | number;
}

async function generatePdf(body: {
  templateId?: string;
  businessName?: string;
  websiteUrl?: string;
  analysis?: StrategyAnalysis;
}): Promise<{ fileName: string; pdfBuffer: Buffer; copyId: string }> {
  const templateId = body.templateId || process.env.GOOGLE_STRATEGY_TEMPLATE_ID || '';
  if (!templateId) throw new Error('templateId es requerido');

  const businessName = normalizeValue(body.businessName);
  const websiteUrl = normalizeValue(body.websiteUrl);
  const analysis = body.analysis || {};
  const topKeywords = Array.isArray(analysis.top_keywords) ? analysis.top_keywords.slice(0, 5) : [];
  const documentDate = formatDocumentDate();

  if (topKeywords.length !== 5) {
    throw new Error('Se requieren exactamente 5 keywords para generar la presentación');
  }

  // 1. Duplicate the template so we never modify the original
  const copy = await driveRequest(
    `/files/${encodeURIComponent(templateId)}/copy?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `_tmp_${Date.now()}` }),
    },
  ) as { id: string };
  const copyId = copy.id;

  // 2. Apply replacements on the copy
  const replacements = [
    { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName },
    { containsText: { text: '{{URL_SITIO}}', matchCase: true }, replaceText: websiteUrl },
    { containsText: { text: '{{FECHA_DOCUMENTO}}', matchCase: true }, replaceText: documentDate },
    { containsText: { text: '{{VISITAS_MES}}', matchCase: true }, replaceText: normalizeValue(analysis.monthly_visits, '0') },
    { containsText: { text: '{{VELOCIDAD_SCORE}}', matchCase: true }, replaceText: normalizeValue(analysis.site_speed_score, '0') },
    { containsText: { text: '{{SALUD_TECNICA}}', matchCase: true }, replaceText: normalizeValue(analysis.technical_health_score, '0') },
  ];
  topKeywords.forEach((item, i) => {
    const idx = i + 1;
    replacements.push(
      { containsText: { text: `{{KEYWORD_${idx}}}`, matchCase: true }, replaceText: normalizeValue(item.keyword) },
      { containsText: { text: `{{KEYWORD_${idx}_POSICION}}`, matchCase: true }, replaceText: positionLabel(item.position) },
    );
  });

  await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: replacements.map((r) => ({ replaceAllText: r })) }),
  });

  // 3. Export PDF
  const pdfBuffer = await driveExportPdf(copyId);
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO - ${businessName} - ${timestamp}`)}.pdf`;

  return { fileName, pdfBuffer, copyId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let copyId: string | undefined;
  try {
    const { fileName, pdfBuffer, copyId: cid } = await generatePdf(req.body as Parameters<typeof generatePdf>[0]);
    copyId = cid;

    const outputFolderId = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID;

    if (outputFolderId) {
      // Upload PDF to Drive and return the Drive link
      const uploaded = await driveUploadMultipart(
        { name: fileName, parents: [outputFolderId] },
        pdfBuffer,
        'application/pdf',
      );
      // Delete the temp copy
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
      res.status(200).json({
        success: true,
        fileName,
        localPath: uploaded.webViewLink,
        driveUrl: uploaded.webViewLink,
        driveFileId: uploaded.id,
      });
    } else {
      // Return PDF as binary download
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-File-Name', fileName);
      res.status(200).send(pdfBuffer);
    }
  } catch (err: unknown) {
    // Clean up temp copy if it was created
    if (copyId) {
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
