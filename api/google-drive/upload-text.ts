import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveUploadMultipart } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { name, parentId, content, mimeType } = req.body as {
      name?: string; parentId?: string; content?: string; mimeType?: string;
    };
    if (!name) { res.status(400).json({ error: 'name es requerido' }); return; }
    if (typeof content !== 'string') { res.status(400).json({ error: 'content debe ser string' }); return; }
    const data = await driveUploadMultipart(
      { name, ...(parentId ? { parents: [parentId] } : {}) },
      Buffer.from(content, 'utf8'),
      mimeType || 'text/plain; charset=utf-8',
    );
    res.status(200).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
