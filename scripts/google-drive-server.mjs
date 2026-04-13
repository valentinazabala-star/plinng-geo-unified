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
const SE_RANKING_BASE = process.env.SE_RANKING_BASE_URL || 'https://api.seranking.com';
const DEFAULT_STRATEGY_WORKING_TEMPLATE_ID = process.env.GOOGLE_STRATEGY_WORKING_TEMPLATE_ID
  || process.env.GOOGLE_STRATEGY_TEMPLATE_ID
  || '';
const DEFAULT_STRATEGY_NO_WEBSITE_TEMPLATE_ID = process.env.GOOGLE_STRATEGY_NO_WEBSITE_TEMPLATE_ID || '';
const DEFAULT_STRATEGY_OUTPUT_FOLDER_ID = process.env.GOOGLE_STRATEGY_OUTPUT_FOLDER_ID || '';
const DEFAULT_LOCAL_OUTPUT_DIR = process.env.GOOGLE_STRATEGY_LOCAL_OUTPUT_DIR
  || path.join(process.env.USERPROFILE || ROOT_DIR, 'Downloads');

let cachedToken = null;
const seRankingStrategyCache = new Map();
const SE_RANKING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

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

function buildTrafficChartUrl(visits = []) {
  const safeVisits = Array.isArray(visits) && visits.length === 6 ? visits : [0, 0, 0, 0, 0, 0];
  const config = {
    type: 'line',
    data: {
      labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
      datasets: [{
        data: safeVisits,
        borderColor: '#A4D62C',
        backgroundColor: 'rgba(164, 214, 44, 0.16)',
        borderWidth: 4,
        pointRadius: 5,
        pointHoverRadius: 5,
        pointBackgroundColor: '#A4D62C',
        pointBorderColor: '#A4D62C',
        tension: 0.35,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.55,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      layout: {
        padding: { left: 28, right: 28, top: 24, bottom: 24 },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#94A3B8',
            font: { size: 13, weight: '700' },
          },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#E2E8F0', borderDash: [4, 4] },
          ticks: {
            color: '#64748B',
            font: { size: 11, weight: '700' },
          },
          border: { display: false },
        },
      },
    },
  };

  return `https://quickchart.io/chart?width=1100&height=700&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(config))}`;
}

function findPlaceholderShape(presentation, placeholderText) {
  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];

  for (const slide of slides) {
    const pageElements = Array.isArray(slide?.pageElements) ? slide.pageElements : [];
    for (const element of pageElements) {
      const textElements = element?.shape?.text?.textElements;
      if (!Array.isArray(textElements)) continue;
      const textContent = textElements
        .map((textElement) => textElement?.textRun?.content || '')
        .join('');

      if (!textContent.includes(placeholderText)) continue;
      if (!element.size || !element.transform) continue;

      return {
        pageObjectId: slide.objectId,
        objectId: element.objectId,
        size: element.size,
        transform: element.transform,
      };
    }
  }

  return null;
}

function findPlaceholderObjects(presentation, placeholderTexts = []) {
  const lookup = new Map();
  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];

  for (const slide of slides) {
    const pageElements = Array.isArray(slide?.pageElements) ? slide.pageElements : [];
    for (const element of pageElements) {
      const textElements = element?.shape?.text?.textElements;
      if (!Array.isArray(textElements)) continue;
      const textContent = textElements
        .map((textElement) => textElement?.textRun?.content || '')
        .join('');

      for (const placeholderText of placeholderTexts) {
        if (!placeholderText) continue;
        if (!textContent.includes(placeholderText)) continue;
        const current = lookup.get(placeholderText) || [];
        current.push({
          pageObjectId: slide.objectId,
          objectId: element.objectId,
        });
        lookup.set(placeholderText, current);
      }
    }
  }

  return lookup;
}

function buildTargetedTextReplacementRequests(placeholderObjects, replacementMap) {
  const requests = [];

  for (const [placeholderText, replaceText] of Object.entries(replacementMap)) {
    const targets = placeholderObjects.get(placeholderText) || [];
    for (const target of targets) {
      requests.push(
        {
          deleteText: {
            objectId: target.objectId,
            textRange: {
              type: 'ALL',
            },
          },
        },
        {
          insertText: {
            objectId: target.objectId,
            insertionIndex: 0,
            text: replaceText,
          },
        },
      );
    }
  }

  return requests;
}

function buildChartElementProperties(placeholder, templateId = '') {
  if (templateId === '1Z7dSM4xEM1o_HO_QKB8ApVEfx1GbDvML55MXWCil7xQ') {
    return {
      size: {
        width: { magnitude: 3300000, unit: 'EMU' },
        height: { magnitude: 2100000, unit: 'EMU' },
      },
      transform: {
        scaleX: 1,
        scaleY: 1,
        translateX: 1450000,
        translateY: 4850000,
        unit: 'EMU',
      },
    };
  }

  const scaleX = Number(placeholder?.transform?.scaleX) || 1;
  const scaleY = Number(placeholder?.transform?.scaleY) || 1;
  const currentWidth = Math.max(
    1,
    Math.round((Number(placeholder?.size?.width?.magnitude) || 0) * scaleX)
  );
  const currentHeight = Math.max(
    1,
    Math.round((Number(placeholder?.size?.height?.magnitude) || 0) * scaleY)
  );
  const squareSize = Math.max(
    2600000,
    Math.round(Math.min(currentWidth, currentHeight * 3.4, 3200000))
  );
  const width = squareSize;
  const height = width;
  const translateX = Math.round(
    (Number(placeholder?.transform?.translateX) || 0) + Math.max(0, (currentWidth - width) / 2)
  );
  const translateY = Math.round(
    (Number(placeholder?.transform?.translateY) || 0) - Math.max(0, (height - currentHeight) / 2) + 120000
  );

  return {
    size: {
      width: { magnitude: width, unit: 'EMU' },
      height: { magnitude: height, unit: 'EMU' },
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX,
      translateY,
      unit: 'EMU',
    },
  };
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

async function googleDriveCopyFile(fileId, body = {}) {
  return googleDriveRequest(`/files/${encodeURIComponent(fileId)}/copy?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getSeRankingApiKey() {
  const apiKey = process.env.SE_RANKING_API_KEY || '';
  if (!apiKey.trim()) {
    throw new Error('Falta configurar SE_RANKING_API_KEY en .env.server');
  }
  return apiKey.trim();
}

async function seRankingRequest(endpoint, init = {}) {
  const apiKey = getSeRankingApiKey();
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${SE_RANKING_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: 'application/json',
        ...(init.headers || {}),
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (response.ok) {
      return data;
    }

    const errorText = typeof data === 'string' ? data : JSON.stringify(data);
    const isRateLimited = response.status === 429 || /too many requests/i.test(errorText);
    if (isRateLimited && attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 4000));
      continue;
    }

    throw new Error(errorText);
  }
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

async function handleSeRankingHealth() {
  return seRankingRequest('/v1/account/subscription');
}

async function handleSeRankingProxy(body) {
  const method = String(body.method || 'GET').toUpperCase();
  const endpoint = String(body.endpoint || '').trim();
  const query = body.query && typeof body.query === 'object' ? body.query : null;
  const requestBody = body.body && typeof body.body === 'object' ? body.body : null;

  if (!endpoint.startsWith('/v1/')) {
    throw new Error('endpoint debe comenzar con /v1/');
  }

  if (!['GET', 'POST'].includes(method)) {
    throw new Error('Solo se permiten métodos GET y POST');
  }

  const url = new URL(`${SE_RANKING_BASE}${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return seRankingRequest(`${url.pathname}${url.search}`, {
    method,
    headers: requestBody ? { 'Content-Type': 'application/json' } : undefined,
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
}

function normalizeDomain(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('websiteUrl es requerido');
  }

  const candidate = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `https://${rawUrl}`;

  const parsed = new URL(candidate);
  return parsed.hostname.replace(/^www\./i, '');
}

function buildSeRankingUrl(endpoint, query = {}) {
  const url = new URL(`${SE_RANKING_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function normalizeMonthlyHistory(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items
    .slice()
    .sort((a, b) => {
      const left = Number(a.year || 0) * 100 + Number(a.month || 0);
      const right = Number(b.year || 0) * 100 + Number(b.month || 0);
      return left - right;
    })
    .slice(-6)
    .map((item) => Math.max(0, Math.round(Number(item.traffic_sum) || 0)));
}

function buildFallbackHistory(monthlyVisits) {
  const base = Math.max(0, Math.round(Number(monthlyVisits) || 0));
  if (!base) return [0, 0, 0, 0, 0, 0];
  return [0.72, 0.79, 0.86, 0.92, 0.97, 1].map((factor) => Math.max(0, Math.round(base * factor)));
}

function getWorldwideOrganicMetrics(payload, source) {
  const organic = Array.isArray(payload?.organic) ? payload.organic : [];
  const worldwide = organic.find((item) => String(item?.source || '').toLowerCase() === 'worldwide');
  const regional = organic.find((item) => String(item?.source || '').toLowerCase() === source);

  return {
    worldwide: worldwide || null,
    regional: regional || null,
  };
}

function pickBestRegionalSource(payload, preferredSource) {
  const organic = Array.isArray(payload?.organic) ? payload.organic : [];
  const normalizedPreferred = String(preferredSource || '').toLowerCase();
  const preferred = organic.find((item) => String(item?.source || '').toLowerCase() === normalizedPreferred);

  if (preferred && Number(preferred?.traffic_sum || 0) > 0) {
    return normalizedPreferred;
  }

  const bestRegional = organic
    .filter((item) => {
      const source = String(item?.source || '').toLowerCase();
      return source && source !== 'worldwide';
    })
    .sort((a, b) => Number(b?.traffic_sum || 0) - Number(a?.traffic_sum || 0))[0];

  return String(bestRegional?.source || normalizedPreferred || 'us').toLowerCase();
}

function buildTopKeywords(items, domain) {
  const keywords = Array.isArray(items)
    ? items
      .map((item) => ({
        keyword: String(item?.keyword || '').trim(),
        position: item?.position == null ? null : Math.max(1, Math.round(Number(item.position) || 1)),
        traffic: Math.max(0, Math.round(Number(item?.traffic) || 0)),
      }))
      .filter((item) => item.keyword)
      .sort((a, b) => b.traffic - a.traffic)
    : [];

  const unique = [];
  const seen = new Set();
  for (const item of keywords) {
    const key = item.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ keyword: item.keyword, position: item.position });
    if (unique.length === 5) break;
  }

  while (unique.length < 5) {
    unique.push({
      keyword: unique.length === 0 ? domain : `${domain} ${unique.length + 1}`,
      position: null,
    });
  }

  return unique;
}

function calculateSpeedScore(report) {
  const speedSection = Array.isArray(report?.sections)
    ? report.sections.find((section) => section?.uid === 'speed_performance_v2')
    : null;

  if (!speedSection?.props || typeof speedSection.props !== 'object') {
    return Math.max(0, Math.min(100, Math.round(Number(report?.score_percent) || 0)));
  }

  let penalty = 0;
  for (const item of Object.values(speedSection.props)) {
    const issueCount = Math.max(0, Math.round(Number(item?.value) || 0));
    if (!issueCount) continue;

    if (item?.status === 'error') penalty += issueCount * 12;
    else if (item?.status === 'warning') penalty += issueCount * 7;
    else if (item?.status === 'notice') penalty += issueCount * 3;
  }

  if (penalty === 0) return 100;
  return Math.max(0, Math.min(100, 100 - penalty));
}

async function pollAuditUntilFinished(auditId) {
  const maxAttempts = 36;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await seRankingRequest(buildSeRankingUrl('/v1/site-audit/audits/status', { audit_id: auditId }));
    if (status?.status === 'finished') return status;
    if (status?.status === 'cancelled' || status?.status === 'expired') {
      throw new Error(`Audit SE Ranking terminó con estado ${status.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('SE Ranking tardó demasiado en completar el audit técnico');
}

async function findLatestFinishedAudit(domain) {
  const audits = await seRankingRequest(buildSeRankingUrl('/v1/site-audit/audits', {
    limit: 20,
    search: domain,
  }));

  const items = Array.isArray(audits?.items) ? audits.items : [];
  const match = items.find((item) => {
    if (item?.status !== 'finished') return false;
    const rawUrl = String(item?.url || '').trim();
    if (!rawUrl) return false;
    try {
      return normalizeDomain(rawUrl) === domain;
    } catch {
      return false;
    }
  });

  return match || null;
}

async function getAuditReportForStrategy(domain) {
  const existingAudit = await findLatestFinishedAudit(domain);
  if (existingAudit?.id) {
    return {
      auditId: existingAudit.id,
      report: await seRankingRequest(buildSeRankingUrl('/v1/site-audit/audits/report', {
        audit_id: existingAudit.id,
      })),
      reused: true,
    };
  }

  const auditCreation = await seRankingRequest('/v1/site-audit/audits/standard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain,
      title: `Strategy SEO - ${domain}`,
      settings: {
        source_site: 1,
        source_sitemap: 1,
        source_subdomain: 0,
        max_pages: 25,
        max_depth: 3,
        max_req: 100,
        send_report: 0,
      },
    }),
  });

  if (!auditCreation?.id) {
    throw new Error('SE Ranking no devolvió audit id');
  }

  await pollAuditUntilFinished(auditCreation.id);
  return {
    auditId: auditCreation.id,
    report: await seRankingRequest(buildSeRankingUrl('/v1/site-audit/audits/report', {
      audit_id: auditCreation.id,
    })),
    reused: false,
  };
}

async function handleSeRankingStrategyAnalysis(body) {
  const websiteUrl = String(body.websiteUrl || '').trim();
  const businessName = String(body.businessName || '').trim();
  const source = String(body.source || 'us').trim().toLowerCase();
  const domain = normalizeDomain(websiteUrl);
  const cacheKey = `${source}:${domain}`;
  const cached = seRankingStrategyCache.get(cacheKey);
  if (cached && (Date.now() - cached.createdAt) < SE_RANKING_CACHE_TTL_MS) {
    return { ...cached.payload, cached: true };
  }

  const worldwideOverview = await seRankingRequest(buildSeRankingUrl('/v1/domain/overview/worldwide', {
    domain,
    currency: 'USD',
  }));
  const overviewMetrics = getWorldwideOrganicMetrics(worldwideOverview, source);
  const selectedSource = pickBestRegionalSource(worldwideOverview, source);

  const history = await seRankingRequest(buildSeRankingUrl('/v1/domain/overview/history', {
    source: selectedSource,
    domain,
    type: 'organic',
    with_subdomains: 1,
  }));

  const historySeries = normalizeMonthlyHistory(history);
  const monthlyVisits = Math.max(
    0,
    Math.round(
      Number(overviewMetrics.worldwide?.traffic_sum)
      || Number(overviewMetrics.regional?.traffic_sum)
      || historySeries[historySeries.length - 1]
      || 0
    )
  );
  const normalizedHistorySeries = historySeries.length === 6 && historySeries.some((value) => value > 0)
    ? historySeries
    : buildFallbackHistory(monthlyVisits);
  const keywordsCount = Math.max(
    0,
    Math.round(
      Number(overviewMetrics.worldwide?.keywords_count)
      || Number(overviewMetrics.regional?.keywords_count)
      || 0
    )
  );

  const keywordsResponse = await seRankingRequest(buildSeRankingUrl('/v1/domain/keywords', {
    domain,
    source: selectedSource,
    type: 'organic',
    limit: 5,
  }));
  const topKeywords = buildTopKeywords(keywordsResponse, businessName || domain);

  const auditData = await getAuditReportForStrategy(domain);
  const auditReport = auditData.report;
  const payload = {
    source: 'se_ranking',
    domain,
    selected_source: selectedSource,
    audit_id: auditData.auditId,
    reused_audit: auditData.reused,
    monthly_visits: monthlyVisits,
    keywords_count: keywordsCount,
    monthly_visits_last_6_months: normalizedHistorySeries,
    monthly_visits_source: `SE Ranking API - aproximacion del modulo Investigacion de la competencia (${selectedSource.toUpperCase()})`,
    site_speed_score: calculateSpeedScore(auditReport),
    technical_health_score: Math.max(0, Math.min(100, Math.round(Number(auditReport?.score_percent) || 0))),
    top_keywords: topKeywords,
  };
  seRankingStrategyCache.set(cacheKey, {
    createdAt: Date.now(),
    payload,
  });
  return payload;
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

function formatGrowthValue(analysis) {
  const percentage = normalizeReplacementValue(analysis?.growth_percentage, '0');
  const direction = String(analysis?.growth_direction || 'flat').toLowerCase();
  if (direction === 'up') return `+${percentage}`;
  if (direction === 'down') return `-${percentage}`;
  return percentage;
}

async function applyTemplateAndSavePdf({
  templateId,
  applyRequests = [],
  preparePresentation,
  cleanupRequests = [],
  restoreRequests = [],
  localOutputDir,
  fileName,
}) {
  const localPath = path.join(localOutputDir, fileName);

  try {
    const preparedRequests = typeof preparePresentation === 'function'
      ? await preparePresentation(templateId)
      : [];
    const finalApplyRequests = [
      ...applyRequests,
      ...(Array.isArray(preparedRequests) ? preparedRequests : []),
    ];

    await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: finalApplyRequests,
      }),
    });

    const pdfBuffer = await googleDriveExportPdf(templateId);
    await mkdir(localOutputDir, { recursive: true });
    await writeFile(localPath, pdfBuffer);
  } finally {
    const revertRequests = [
      ...cleanupRequests,
      ...restoreRequests,
    ];

    if (revertRequests.length) {
      await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: revertRequests,
        }),
      }).catch(() => {});
    }
  }

  return { success: true, localPath, fileName, templateUntouched: true };
}

async function handleGenerateStrategyPdf(body) {
  const templateId = body.templateId || DEFAULT_STRATEGY_WORKING_TEMPLATE_ID;
  if (!templateId) throw new Error('templateId es requerido');

  const businessName = normalizeReplacementValue(body.businessName);
  const websiteUrl = normalizeReplacementValue(body.websiteUrl);
  const analysis = body.analysis || {};
  const topKeywords = Array.isArray(analysis.top_keywords) ? analysis.top_keywords.slice(0, 5) : [];
  const documentDate = formatDocumentDate();

  if (topKeywords.length !== 5) {
    throw new Error('Se requieren exactamente 5 keywords para generar la presentación');
  }

  const placeholdersToRestore = [
    '{{NOMBRE_COMERCIAL}}',
    '{{URL_SITIO}}',
    '{{FECHA_DOCUMENTO}}',
    '{{VISITAS_MES}}',
    '{{POR_CRECIMIENTO}}',
    '{{VELOCIDAD_SCORE}}',
    '{{SALUD_TECNICA}}',
    '{{EV_TRAFICO}}',
    '{{KEYWORD_1}}',
    '{{KEYWORD_1_POSICION}}',
    '{{KEYWORD_2}}',
    '{{KEYWORD_2_POSICION}}',
    '{{KEYWORD_3}}',
    '{{KEYWORD_3_POSICION}}',
    '{{KEYWORD_4}}',
    '{{KEYWORD_4_POSICION}}',
    '{{KEYWORD_5}}',
    '{{KEYWORD_5_POSICION}}',
  ];
  const presentation = await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}`);
  const placeholderObjects = findPlaceholderObjects(presentation, placeholdersToRestore);

  const replacementMap = {
    '{{NOMBRE_COMERCIAL}}': businessName,
    '{{URL_SITIO}}': websiteUrl,
    '{{FECHA_DOCUMENTO}}': documentDate,
    '{{VISITAS_MES}}': normalizeReplacementValue(analysis.monthly_visits, '0'),
    '{{POR_CRECIMIENTO}}': formatGrowthValue(analysis),
    '{{VELOCIDAD_SCORE}}': normalizeReplacementValue(analysis.site_speed_score, '0'),
    '{{SALUD_TECNICA}}': normalizeReplacementValue(analysis.technical_health_score, '0'),
  };

  topKeywords.forEach((item, index) => {
    const idx = index + 1;
    replacementMap[`{{KEYWORD_${idx}}}`] = normalizeReplacementValue(item.keyword);
    replacementMap[`{{KEYWORD_${idx}_POSICION}}`] = positionLabel(item.position);
  });

  const applyRequests = buildTargetedTextReplacementRequests(placeholderObjects, replacementMap);
  const restoreRequests = [];
  placeholdersToRestore.forEach((placeholderText) => {
    const targets = placeholderObjects.get(placeholderText) || [];
    for (const target of targets) {
      restoreRequests.push(
        {
          deleteText: {
            objectId: target.objectId,
            textRange: {
              type: 'ALL',
            },
          },
        },
        {
          insertText: {
            objectId: target.objectId,
            insertionIndex: 0,
            text: placeholderText,
          },
        },
      );
    }
  });
  const localOutputDir = body.localOutputDir || DEFAULT_LOCAL_OUTPUT_DIR;
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO - ${businessName} - ${timestamp}`)}.pdf`;
  const cleanupRequests = [];
  return applyTemplateAndSavePdf({
    templateId,
    applyRequests,
    cleanupRequests,
    restoreRequests,
    preparePresentation: async (presentationId) => {
      const chartPlaceholder = findPlaceholderShape(presentation, '{{EV_TRAFICO}}');
      if (!chartPlaceholder) return [];
      const chartBounds = buildChartElementProperties(chartPlaceholder, templateId);
      const chartImageId = `evTraficoChart${Date.now()}`;
      const placeholderId = chartPlaceholder.objectId;

      cleanupRequests.length = 0;
      cleanupRequests.push(
        {
          deleteObject: {
            objectId: chartImageId,
          },
        },
        {
          insertText: {
            objectId: placeholderId,
            insertionIndex: 0,
            text: '{{EV_TRAFICO}}',
          },
        },
      );

      return [
        {
          deleteText: {
            objectId: placeholderId,
            textRange: {
              type: 'ALL',
            },
          },
        },
        {
          createImage: {
            objectId: chartImageId,
            url: buildTrafficChartUrl(analysis.monthly_visits_last_6_months),
            elementProperties: {
              pageObjectId: chartPlaceholder.pageObjectId,
              ...chartBounds,
            },
          },
        },
        {
          updatePageElementsZOrder: {
            pageElementObjectIds: [chartImageId],
            operation: 'BRING_TO_FRONT',
          },
        },
      ];
    },
    localOutputDir,
    fileName,
  });
}

async function handleGenerateStrategyNoWebsitePdf(body) {
  const templateId = body.templateId || DEFAULT_STRATEGY_NO_WEBSITE_TEMPLATE_ID;
  if (!templateId) throw new Error('templateId es requerido');

  const businessName = normalizeReplacementValue(body.businessName);
  const documentDate = formatDocumentDate();
  const presentation = await googleSlidesRequest(`/presentations/${encodeURIComponent(templateId)}`);
  const placeholderObjects = findPlaceholderObjects(presentation, [
    '{{NOMBRE_COMERCIAL}}',
    '{{FECHA_DOCUMENTO}}',
  ]);
  const localOutputDir = body.localOutputDir || DEFAULT_LOCAL_OUTPUT_DIR;
  const timestamp = new Date().toISOString().slice(0, 10);
  const fileName = `${sanitizeFileName(`Estrategia SEO Sin Web - ${businessName} - ${timestamp}`)}.pdf`;

  const applyRequests = buildTargetedTextReplacementRequests(placeholderObjects, {
    '{{NOMBRE_COMERCIAL}}': businessName,
    '{{FECHA_DOCUMENTO}}': documentDate,
  });
  const restoreRequests = [];
  ['{{NOMBRE_COMERCIAL}}', '{{FECHA_DOCUMENTO}}'].forEach((placeholderText) => {
    const targets = placeholderObjects.get(placeholderText) || [];
    for (const target of targets) {
      restoreRequests.push(
        {
          deleteText: {
            objectId: target.objectId,
            textRange: {
              type: 'ALL',
            },
          },
        },
        {
          insertText: {
            objectId: target.objectId,
            insertionIndex: 0,
            text: placeholderText,
          },
        },
      );
    }
  });

  return applyTemplateAndSavePdf({
    templateId,
    applyRequests,
    restoreRequests,
    localOutputDir,
    fileName,
  });
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

    if (reqUrl.pathname === '/api/se-ranking/health' && req.method === 'GET') {
      sendJson(res, 200, await handleSeRankingHealth());
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

    if (reqUrl.pathname === '/api/se-ranking/request' && req.method === 'POST') {
      sendJson(res, 200, await handleSeRankingProxy(body));
      return;
    }

    if (reqUrl.pathname === '/api/se-ranking/strategy-analysis' && req.method === 'POST') {
      sendJson(res, 200, await handleSeRankingStrategyAnalysis(body));
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
