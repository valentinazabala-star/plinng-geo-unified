import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors, driveRequest } from './_lib.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const folderId = req.query.folderId as string | undefined;
    const pageSize = req.query.pageSize as string || '25';
    const query = folderId
      ? `'${folderId}' in parents and trashed = false`
      : 'trashed = false';
    const data = await driveRequest(
      `/files?q=${encodeURIComponent(query)}&pageSize=${encodeURIComponent(pageSize)}&fields=files(id,name,mimeType,webViewLink,parents,modifiedTime,size)`,
    );
    res.status(200).json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
