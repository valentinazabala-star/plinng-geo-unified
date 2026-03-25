import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body as {
    templateId?: string;
    businessName?: string;
    websiteUrl?: string;
    analysis?: StrategyAnalysis;
  };

  const templateId = body.templateId || process.env.GOOGLE_STRATEGY_TEMPLATE_ID || '';
  if (!templateId) { res.status(400).json({ error: 'templateId es requerido' }); return; }

  const businessName = normalizeValue(body.businessName);
  const websiteUrl = normalizeValue(body.websiteUrl);
  const analysis = body.analysis || {};
  const topKeywords = Array.isArray(analysis.top_keywords) ? analysis.top_keywords.slice(0, 5) : [];
  const documentDate = formatDocumentDate();

  if (topKeywords.length !== 5) {
    res.status(400).json({ error: 'Se requieren exactamente 5 keywords para generar la presentación' });
    return;
  }

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

  const restoreRequests = [
    { containsText: { text: businessName, matchCase: true }, replaceText: '{{NOMBRE_COMERCIAL}}' },
    { containsText: { text: websiteUrl, matchCase: true }, replaceText: '{{URL_SITIO}}' },
    { containsText: { text: documentDate, matchCase: true }, replaceText: '{{FECHA_DOCUMENTO}}' },
    { containsText: { text: normalizeValue(analysis.monthly_visits, '0'), matchCase: true }, replaceText: '{{VISITAS_MES}}' },
    { containsText: { text: normalizeValue(analysis.site_speed_score, '0'), matchCase: true }, replaceText: '{{VELOCIDAD_SCORE}}' },
    { containsText: { text: normalizeValue(analysis.technical_health_score, '0'), matchCase: true }, replaceText: '{{SALUD_TECNICA}}' },
  ];
  topKeywords.forEach((item, i) => {
    const idx = i + 1;
    restoreRequests.push(
      { containsText: { text: normalizeValue(item.keyword), matchCase: true }, replaceText: `{{KEYWORD_${idx}}}` },
      { containsText: { text: positionLabel(item.position), matchCase: true }, replaceText: `{{KEYWORD_${idx}_POSICION}}` },
    );
  });

  let pdfBuffer: Buffer;
  try {
    // 1. Apply replacements directly on the template
    await slidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: replacements.map((r) => ({ replaceAllText: r })) }),
    });

    // 2. Export PDF
    pdfBuffer = await driveExportPdf(templateId);
  } finally {
    // 3. Always restore the template
    await slidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: restoreRequests.map((r) => ({ replaceAllText: r })) }),
    }).catch(() => {});
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO - ${businessName} - ${timestamp}`)}.pdf`;

  try {
    const outputFolderId = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID;
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
      });
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-File-Name', fileName);
      res.status(200).send(pdfBuffer);
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
