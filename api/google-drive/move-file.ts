import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveRequest } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { fileId, newParentId, removeParentId } = req.body as {
      fileId?: string; newParentId?: string; removeParentId?: string;
    };
    if (!fileId || !newParentId) {
      res.status(400).json({ error: 'fileId y newParentId son requeridos' }); return;
    }
    const params = new URLSearchParams({ addParents: newParentId, fields: 'id,name,parents,webViewLink' });
    if (removeParentId) params.set('removeParents', removeParentId);
    const data = await driveRequest(`/files/${encodeURIComponent(fileId)}?${params}`, { method: 'PATCH' });
    res.status(200).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
