import { createSign } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_SLIDES_BASE = 'https://slides.googleapis.com/v1';

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function getAccessToken(): Promise<string> {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let sa: { client_email: string; private_key: string; token_uri: string };

  if (inlineJson) {
    sa = JSON.parse(inlineJson);
  } else {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) {
      throw new Error(
        'Faltan credenciales de Google. Configura GOOGLE_CLIENT_EMAIL y GOOGLE_PRIVATE_KEY en las variables de entorno de Vercel.',
      );
    }
    sa = {
      client_email: clientEmail,
      private_key: privateKey,
      token_uri: process.env.GOOGLE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer
    .sign(sa.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`No se pudo obtener access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

export async function driveRequest(endpoint: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const url = endpoint.startsWith('http') ? endpoint : `${GOOGLE_DRIVE_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> || {}) },
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const err = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
    throw new Error(err);
  }
  return ct.includes('application/json') ? res.json() : res.text();
}

export async function slidesRequest(endpoint: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${GOOGLE_SLIDES_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export async function driveExportPdf(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(
    `${GOOGLE_DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/pdf')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(await res.text());
  return Buffer.from(await res.arrayBuffer());
}

export async function driveUploadMultipart(
  metadata: object,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<{ id: string; name: string; webViewLink: string }> {
  const token = await getAccessToken();
  const boundary = `drive-boundary-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink,parents,mimeType`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const data = await res.json() as { id: string; name: string; webViewLink: string };
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export function cors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
}

export async function readBody(req: VercelRequest): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
  // body not yet parsed — shouldn't happen with @vercel/node, but just in case
  return {};
}

// Shared helpers
export function normalizeValue(value: unknown, fallback = 'N/D'): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function positionLabel(position: unknown): string {
  if (position == null || Number.isNaN(Number(position))) return 'N/D';
  return String(Math.round(Number(position)));
}

export function sanitizeFileName(value: string): string {
  return String(value || 'estrategia-seo')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatDocumentDate(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}
