import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  cors,
  driveCopyFile,
  driveDeleteFile,
  slidesRequest,
  driveExportPdf,
  driveUploadMultipart,
  normalizeValue,
  sanitizeFileName,
  formatDocumentDate,
} from './_lib.js';

// ─── Template IDs (no-website variants) ──────────────────────────────────────
const TEMPLATE_NO_WEB: Record<string, string> = {
  spanish: '1__jgfwa9uZbD-7BxKwfIWr-wcN-OmEOKM_9hY47ws3Y',
  other:   '1K0VEa036zLaYLCn5Ax7z2tuY2MRszTi_dUkUoLjBroE',
};

function getTemplateId(language: string | undefined): string {
  const isEnglish = (language ?? '').toLowerCase() === 'english';
  if (!isEnglish && process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID) {
    return process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID;
  }
  return isEnglish ? TEMPLATE_NO_WEB.other : TEMPLATE_NO_WEB.spanish;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body as { templateId?: string; businessName?: string; language?: string };
  const templateId   = body.templateId || getTemplateId(body.language);
  const businessName = normalizeValue(body.businessName);
  const documentDate = formatDocumentDate();

  const timestamp      = new Date().toISOString().slice(0, 10);
  const fileName       = `${sanitizeFileName(`Estrategia SEO Sin Web - ${businessName} - ${timestamp}`)}.pdf`;
  const outputFolderId = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID;
  const copy           = await driveCopyFile(templateId, `_tmp_${Date.now()}`, outputFolderId || undefined);
  const copyId         = copy.id;

  let pdfBuffer: Buffer;
  try {
    await slidesRequest(`/presentations/${encodeURIComponent(copyId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { replaceAllText: { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName } },
          { replaceAllText: { containsText: { text: '{{FECHA_DOCUMENTO}}',   matchCase: true }, replaceText: documentDate } },
        ],
      }),
    });
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
