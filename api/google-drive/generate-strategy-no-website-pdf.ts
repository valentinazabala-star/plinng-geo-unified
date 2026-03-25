import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
  slidesRequest,
  driveExportPdf,
  driveUploadMultipart,
  normalizeValue,
  sanitizeFileName,
  formatDocumentDate,
} from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body as { templateId?: string; businessName?: string };
  const templateId = body.templateId || process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID || '';
  if (!templateId) { res.status(400).json({ error: 'templateId es requerido' }); return; }

  const businessName = normalizeValue(body.businessName);
  const documentDate = formatDocumentDate();

  let pdfBuffer: Buffer;
  try {
    // 1. Apply replacements directly on the template
    await slidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { replaceAllText: { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName } },
          { replaceAllText: { containsText: { text: '{{FECHA_DOCUMENTO}}', matchCase: true }, replaceText: documentDate } },
        ],
      }),
    });

    // 2. Export PDF
    pdfBuffer = await driveExportPdf(templateId);
  } finally {
    // 3. Always restore the template
    await slidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { replaceAllText: { containsText: { text: businessName, matchCase: true }, replaceText: '{{NOMBRE_COMERCIAL}}' } },
          { replaceAllText: { containsText: { text: documentDate, matchCase: true }, replaceText: '{{FECHA_DOCUMENTO}}' } },
        ],
      }),
    }).catch(() => {});
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO Sin Web - ${businessName} - ${timestamp}`)}.pdf`;

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
