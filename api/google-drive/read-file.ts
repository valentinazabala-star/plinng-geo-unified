import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveRequest } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { fileId, alt } = req.body as { fileId?: string; alt?: string };
    if (!fileId) { res.status(400).json({ error: 'fileId es requerido' }); return; }
    const endpoint = alt === 'media'
      ? `/files/${encodeURIComponent(fileId)}?alt=media`
      : `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,parents,modifiedTime,size`;
    const data = await driveRequest(endpoint);
    res.status(200).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
