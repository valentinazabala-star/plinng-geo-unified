import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveRequest } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'DELETE') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { fileId } = req.body as { fileId?: string };
    if (!fileId) { res.status(400).json({ error: 'fileId es requerido' }); return; }
    await driveRequest(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    res.status(200).json({ success: true, fileId });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
