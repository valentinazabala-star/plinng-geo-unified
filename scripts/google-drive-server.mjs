import { createServer } from 'node:http';
import { createSign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const ENV_FILE = path.join(ROOT_DIR, '.env.server');
loadEnvFile(ENV_FILE);

const DEFAULT_PORT = Number(process.env.GOOGLE_DRIVE_SERVER_PORT || 8787);
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const GOOGLE_SLIDES_BASE = 'https://slides.googleapis.com/v1';
const DEFAULT_STRATEGY_TEMPLATE_ID = process.env.GOOGLE_STRATEGY_TEMPLATE_ID || '';
const DEFAULT_STRATEGY_NO_WEBSITE_TEMPLATE_ID = process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID || '';
const DEFAULT_STRATEGY_OUTPUT_FOLDER_ID = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID || '';
const DEFAULT_LOCAL_OUTPUT_DIR = process.env.GOOGLE_STRATEGY_LOCAL_OUTPUT_DIR
  || path.join(process.env.USERPROFILE || ROOT_DIR, 'Downloads');

let cachedToken = null;

function loadEnvFile(filePath) {
  try {
    const content = requireText(filePath);
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const rawValue = trimmed.slice(eqIndex + 1).trim();
      const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env.server is optional
  }
}

function requireText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function loadServiceAccount() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;

  if (inlineJson) return JSON.parse(inlineJson);
  if (jsonPath) {
    const content = await readFile(jsonPath, 'utf8');
    return JSON.parse(content);
  }

  throw new Error(
    'Falta configurar GOOGLE_SERVICE_ACCOUNT_JSON_PATH o GOOGLE_SERVICE_ACCOUNT_JSON en .env.server'
  );
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.accessToken;

  const serviceAccount = await loadServiceAccount();
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: DRIVE_SCOPE,
    aud: serviceAccount.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const assertion = `${unsignedToken}.${signature}`;
  const response = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`No se pudo obtener access token de Google: ${JSON.stringify(data)}`);
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + Number(data.expires_in || 3600),
  };
  return cachedToken.accessToken;
}

async function googleDriveRequest(endpoint, init = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${GOOGLE_DRIVE_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : JSON.stringify(data));
  }

  return data;
}

async function googleUploadMultipart(metadata, fileBuffer, mimeType) {
  const accessToken = await getAccessToken();
  const boundary = `drive-boundary-${Date.now()}`;
  const metadataPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([metadataPart, fileHeader, fileBuffer, closing]);

  const response = await fetch(`${GOOGLE_DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webViewLink,parents,mimeType`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function googleSlidesRequest(endpoint, init = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${GOOGLE_SLIDES_BASE}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data;
}

async function googleDriveExportPdf(fileId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${GOOGLE_DRIVE_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/pdf')}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function handleList(reqUrl) {
  const folderId = reqUrl.searchParams.get('folderId');
  const pageSize = reqUrl.searchParams.get('pageSize') || '25';
  const query = folderId
    ? `'${folderId}' in parents and trashed = false`
    : 'trashed = false';
  return googleDriveRequest(
    `/files?q=${encodeURIComponent(query)}&pageSize=${encodeURIComponent(pageSize)}&fields=files(id,name,mimeType,webViewLink,parents,modifiedTime,size)`
  );
}

async function handleCreateFolder(body) {
  const { name, parentId } = body;
  if (!name) throw new Error('name es requerido');
  return googleDriveRequest('/files?fields=id,name,webViewLink,parents,mimeType', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
}

async function handleUploadText(body) {
  const { name, parentId, content, mimeType } = body;
  if (!name) throw new Error('name es requerido');
  if (typeof content !== 'string') throw new Error('content debe ser string');
  return googleUploadMultipart(
    {
      name,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    Buffer.from(content, 'utf8'),
    mimeType || 'text/plain; charset=utf-8'
  );
}

async function handleUploadFile(body) {
  const { name, parentId, localPath, mimeType } = body;
  if (!localPath) throw new Error('localPath es requerido');
  const fileBuffer = await readFile(localPath);
  return googleUploadMultipart(
    {
      name: name || path.basename(localPath),
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fileBuffer,
    mimeType || 'application/octet-stream'
  );
}

async function handleReadFile(body) {
  const { fileId, alt } = body;
  if (!fileId) throw new Error('fileId es requerido');
  if (alt === 'media') {
    return googleDriveRequest(`/files/${encodeURIComponent(fileId)}?alt=media`, {
      method: 'GET',
    });
  }
  return googleDriveRequest(`/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,parents,modifiedTime,size`);
}

async function handleMoveFile(body) {
  const { fileId, newParentId, removeParentId } = body;
  if (!fileId || !newParentId) throw new Error('fileId y newParentId son requeridos');
  const params = new URLSearchParams({
    addParents: newParentId,
    fields: 'id,name,parents,webViewLink',
  });
  if (removeParentId) params.set('removeParents', removeParentId);
  return googleDriveRequest(`/files/${encodeURIComponent(fileId)}?${params.toString()}`, {
    method: 'PATCH',
  });
}

async function handleDeleteFile(body) {
  const { fileId } = body;
  if (!fileId) throw new Error('fileId es requerido');
  await googleDriveRequest(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  return { success: true, fileId };
}

function normalizeReplacementValue(value, fallback = 'N/D') {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function positionLabel(position) {
  if (position == null || Number.isNaN(Number(position))) return 'N/D';
  return String(Math.round(Number(position)));
}

function sanitizeFileName(value) {
  return String(value || 'estrategia-seo')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDocumentDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

async function applyTemplateAndSavePdf({
  templateId,
  replacements,
  restoreRequests,
  localOutputDir,
  fileName,
}) {
  const localPath = path.join(localOutputDir, fileName);

  try {
    await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: replacements.map((replacement) => ({ replaceAllText: replacement })),
      }),
    });

    const pdfBuffer = await googleDriveExportPdf(templateId);
    await mkdir(localOutputDir, { recursive: true });
    await writeFile(localPath, pdfBuffer);
  } finally {
    await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: restoreRequests.map((replacement) => ({ replaceAllText: replacement })),
      }),
    }).catch(() => {});
  }

  return { success: true, localPath, fileName, templateUntouched: true };
}

async function handleGenerateStrategyPdf(body) {
  const templateId = body.templateId || DEFAULT_STRATEGY_TEMPLATE_ID;
  if (!templateId) throw new Error('templateId es requerido');

  const businessName = normalizeReplacementValue(body.businessName);
  const websiteUrl = normalizeReplacementValue(body.websiteUrl);
  const analysis = body.analysis || {};
  const topKeywords = Array.isArray(analysis.top_keywords) ? analysis.top_keywords.slice(0, 5) : [];
  const documentDate = formatDocumentDate();

  if (topKeywords.length !== 5) {
    throw new Error('Se requieren exactamente 5 keywords para generar la presentación');
  }

  const replacements = [
    { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName },
    { containsText: { text: '{{URL_SITIO}}', matchCase: true }, replaceText: websiteUrl },
    { containsText: { text: '{{FECHA_DOCUMENTO}}', matchCase: true }, replaceText: documentDate },
    { containsText: { text: '{{VISITAS_MES}}', matchCase: true }, replaceText: normalizeReplacementValue(analysis.monthly_visits, '0') },
    { containsText: { text: '{{VELOCIDAD_SCORE}}', matchCase: true }, replaceText: normalizeReplacementValue(analysis.site_speed_score, '0') },
    { containsText: { text: '{{SALUD_TECNICA}}', matchCase: true }, replaceText: normalizeReplacementValue(analysis.technical_health_score, '0') },
  ];

  topKeywords.forEach((item, index) => {
    const idx = index + 1;
    replacements.push(
      { containsText: { text: `{{KEYWORD_${idx}}}`, matchCase: true }, replaceText: normalizeReplacementValue(item.keyword) },
      { containsText: { text: `{{KEYWORD_${idx}_POSICION}}`, matchCase: true }, replaceText: positionLabel(item.position) },
    );
  });
  const restoreRequests = [
    { containsText: { text: businessName, matchCase: true }, replaceText: '{{NOMBRE_COMERCIAL}}' },
    { containsText: { text: websiteUrl, matchCase: true }, replaceText: '{{URL_SITIO}}' },
    { containsText: { text: documentDate, matchCase: true }, replaceText: '{{FECHA_DOCUMENTO}}' },
    { containsText: { text: normalizeReplacementValue(analysis.monthly_visits, '0'), matchCase: true }, replaceText: '{{VISITAS_MES}}' },
    { containsText: { text: normalizeReplacementValue(analysis.site_speed_score, '0'), matchCase: true }, replaceText: '{{VELOCIDAD_SCORE}}' },
    { containsText: { text: normalizeReplacementValue(analysis.technical_health_score, '0'), matchCase: true }, replaceText: '{{SALUD_TECNICA}}' },
  ];

  topKeywords.forEach((item, index) => {
    const idx = index + 1;
    restoreRequests.push(
      { containsText: { text: normalizeReplacementValue(item.keyword), matchCase: true }, replaceText: `{{KEYWORD_${idx}}}` },
      { containsText: { text: positionLabel(item.position), matchCase: true }, replaceText: `{{KEYWORD_${idx}_POSICION}}` },
    );
  });

  const localOutputDir = body.localOutputDir || DEFAULT_LOCAL_OUTPUT_DIR;
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO - ${businessName} - ${timestamp}`)}.pdf`;
  return applyTemplateAndSavePdf({
    templateId,
    replacements,
    restoreRequests,
    localOutputDir,
    fileName,
  });
}

async function handleGenerateStrategyNoWebsitePdf(body) {
  const templateId = body.templateId || DEFAULT_STRATEGY_NO_WEBSITE_TEMPLATE_ID;
  if (!templateId) throw new Error('templateId es requerido');

  const businessName = normalizeReplacementValue(body.businessName);
  const documentDate = formatDocumentDate();
  const localOutputDir = body.localOutputDir || DEFAULT_LOCAL_OUTPUT_DIR;
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO Sin Web - ${businessName} - ${timestamp}`)}.pdf`;

  const replacements = [
    { containsText: { text: '{{NOMBRE_COMERCIAL}}', matchCase: true }, replaceText: businessName },
    { containsText: { text: '{{FECHA_DOCUMENTO}}', matchCase: true }, replaceText: documentDate },
  ];

  const restoreRequests = [
    { containsText: { text: businessName, matchCase: true }, replaceText: '{{NOMBRE_COMERCIAL}}' },
    { containsText: { text: documentDate, matchCase: true }, replaceText: '{{FECHA_DOCUMENTO}}' },
  ];

  return applyTemplateAndSavePdf({
    templateId,
    replacements,
    restoreRequests,
    localOutputDir,
    fileName,
  });
}

// ── SE Ranking handler ────────────────────────────────────────────────────────

const SE_RANKING_BASE = process.env.SE_RANKING_BASE_URL || 'https://api.seranking.com';
const SE_RANKING_API_KEY = process.env.SE_RANKING_API_KEY || '';

function normalizeDomain(url) {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();
}

function detectSeSource(domain) {
  if (/\.es$/.test(domain))      return 'es';
  if (/\.co\.uk$/.test(domain))  return 'uk';
  if (/\.com\.mx$/.test(domain)) return 'mx';
  if (/\.com\.ar$/.test(domain)) return 'ar';
  if (/\.com\.co$/.test(domain)) return 'co';
  if (/\.com\.pe$/.test(domain)) return 'pe';
  if (/\.mx$/.test(domain))      return 'mx';
  if (/\.ar$/.test(domain))      return 'ar';
  if (/\.de$/.test(domain))      return 'de';
  if (/\.fr$/.test(domain))      return 'fr';
  if (/\.it$/.test(domain))      return 'it';
  if (/\.pt$/.test(domain))      return 'pt';
  if (/\.br$/.test(domain))      return 'br';
  return 'us';
}

async function seRankingGet(path) {
  const res = await fetch(`${SE_RANKING_BASE}${path}`, {
    headers: { Authorization: `Token ${SE_RANKING_API_KEY}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SE Ranking ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

function calcGrowthPct(history) {
  if (history.length < 2) return '0';
  const first = history[0].traffic ?? 0;
  const last  = history[history.length - 1].traffic ?? 0;
  if (!first) return last > 0 ? '+100' : '0';
  const pct = Math.round(((last - first) / first) * 100);
  return pct > 0 ? `+${pct}` : `${pct}`;
}

function monthLabelEs(year, month) {
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[(month - 1) % 12]} ${String(year).slice(2)}`;
}

async function handleSeRankingAnalyze(body) {
  const website = body?.website || '';
  if (!website) throw new Error('website is required');

  const domain = normalizeDomain(website);
  const source = detectSeSource(domain);
  const errors = [];

  let monthlyVisits = 0;
  let keywordsCount = 0;
  try {
    const overview = await seRankingGet(`/v1/domain/overview/worldwide?domain=${encodeURIComponent(domain)}`);
    const organic = overview.organic?.[0] ?? {};
    monthlyVisits = Number(organic.traffic_sum ?? 0);
    keywordsCount = Number(organic.keywords_count ?? 0);
  } catch (e) {
    errors.push(`overview: ${e.message}`);
  }

  let topKeywords = [];
  try {
    const kwData = await seRankingGet(
      `/v1/domain/keywords?source=${source}&domain=${encodeURIComponent(domain)}&type=organic&limit=10&order_field=traffic&order_type=desc`,
    );
    topKeywords = (Array.isArray(kwData) ? kwData : [])
      .filter(k => k.keyword)
      .map(k => ({
        keyword:  String(k.keyword ?? ''),
        position: Number(k.position ?? k.pos ?? 0),
        volume:   Number(k.volume ?? k.vol ?? 0),
      }))
      .slice(0, 5);
  } catch (e) {
    errors.push(`keywords: ${e.message}`);
  }

  let trafficHistory = [];
  let trafficGrowthPercent = '0';
  try {
    const histData = await seRankingGet(
      `/v1/domain/overview/history?source=${source}&domain=${encodeURIComponent(domain)}&type=organic`,
    );
    trafficHistory = (Array.isArray(histData) ? histData : [])
      .map(h => ({
        date:    `${h.year}${String(h.month).padStart(2, '0')}`,
        traffic: Number(h.traffic_sum ?? 0),
        year:    Number(h.year),
        month:   Number(h.month),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-6);
    trafficGrowthPercent = calcGrowthPct(trafficHistory);
  } catch (e) {
    errors.push(`history: ${e.message}`);
  }

  const chartLabels = trafficHistory.map(h => monthLabelEs(h.year, h.month));
  const chartData   = trafficHistory.map(h => h.traffic);

  return {
    domain,
    monthly_visits: monthlyVisits,
    keywords_count: keywordsCount,
    top_keywords:   topKeywords,
    traffic_history: trafficHistory,
    traffic_growth_percent: trafficGrowthPercent,
    chart_labels: chartLabels,
    chart_data:   chartData,
    errors: errors.length ? errors : undefined,
  };
}

const server = createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (reqUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'google-drive-server' });
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/list' && req.method === 'GET') {
      sendJson(res, 200, await handleList(reqUrl));
      return;
    }

    if (req.method !== 'POST' && req.method !== 'DELETE') {
      sendJson(res, 404, { error: 'Ruta no encontrada' });
      return;
    }

    const body = await readJsonBody(req);

    if (reqUrl.pathname === '/api/google-drive/create-folder' && req.method === 'POST') {
      sendJson(res, 200, await handleCreateFolder(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/upload-text' && req.method === 'POST') {
      sendJson(res, 200, await handleUploadText(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/upload-file' && req.method === 'POST') {
      sendJson(res, 200, await handleUploadFile(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/read-file' && req.method === 'POST') {
      sendJson(res, 200, await handleReadFile(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/move-file' && req.method === 'POST') {
      sendJson(res, 200, await handleMoveFile(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/generate-strategy-pdf' && req.method === 'POST') {
      sendJson(res, 200, await handleGenerateStrategyPdf(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/generate-strategy-no-website-pdf' && req.method === 'POST') {
      sendJson(res, 200, await handleGenerateStrategyNoWebsitePdf(body));
      return;
    }

    if (reqUrl.pathname === '/api/google-drive/delete-file' && req.method === 'DELETE') {
      sendJson(res, 200, await handleDeleteFile(body));
      return;
    }

    if (reqUrl.pathname === '/api/se-ranking/analyze' && req.method === 'POST') {
      sendJson(res, 200, await handleSeRankingAnalyze(body));
      return;
    }

    sendJson(res, 404, { error: 'Ruta no encontrada' });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
  console.log(`Google Drive server listo en http://127.0.0.1:${DEFAULT_PORT}`);
});
