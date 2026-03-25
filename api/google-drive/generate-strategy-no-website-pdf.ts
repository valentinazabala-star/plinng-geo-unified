import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
  driveRequest,
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

  let copyId: string | undefined;
  try {
    const body = req.body as { templateId?: string; businessName?: string };
    const templateId = body.templateId || process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID || '';
    if (!templateId) throw new Error('templateId es requerido');

    const businessName = normalizeValue(body.businessName);
    const documentDate = formatDocumentDate();

    // 1. Duplicate the template
    const copy = await driveRequest(
      `/files/${encodeURIComponent(templateId)}/copy?fields=id`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `_tmp_${Date.now()}` }),
      },
    ) as { id: string };
    copyId = copy.id;

    // 2. Apply replacements on the copy
    await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { replaceAllText: { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName } },
          { replaceAllText: { containsText: { text: '{{FECHA_DOCUMENTO}}', matchCase: true }, replaceText: documentDate } },
        ],
      }),
    });

    // 3. Export PDF
    const pdfBuffer = await driveExportPdf(copyId);
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `${sanitizeFileName(`Estrategia SEO Sin Web - ${businessName} - ${timestamp}`)}.pdf`;

    const outputFolderId = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID;

    if (outputFolderId) {
      const uploaded = await driveUploadMultipart(
        { name: fileName, parents: [outputFolderId] },
        pdfBuffer,
        'application/pdf',
      );
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
      res.status(200).json({
        success: true,
        fileName,
        localPath: uploaded.webViewLink,
        driveUrl: uploaded.webViewLink,
        driveFileId: uploaded.id,
      });
    } else {
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('X-File-Name', fileName);
      res.status(200).send(pdfBuffer);
    }
  } catch (err: unknown) {
    if (copyId) {
      await driveRequest(`/files/${encodeURIComponent(copyId)}`, { method: 'DELETE' }).catch(() => {});
    }
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
