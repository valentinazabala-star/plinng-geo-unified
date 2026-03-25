import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveRequest } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { name, parentId } = req.body as { name?: string; parentId?: string };
    if (!name) { res.status(400).json({ error: 'name es requerido' }); return; }
    const data = await driveRequest('/files?fields=id,name,webViewLink,parents,mimeType', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    res.status(200).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
