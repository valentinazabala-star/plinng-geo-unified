import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = 'https://api.seranking.com';
const API_KEY = process.env.SE_RANKING_API_KEY ?? '';

function cors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
    .trim();
}

/** Guess a 2-letter source/country code from the domain TLD */
function detectSource(domain: string): string {
  if (/\.es$/.test(domain))     return 'es';
  if (/\.co\.uk$/.test(domain)) return 'uk';
  if (/\.com\.mx$/.test(domain))return 'mx';
  if (/\.com\.ar$/.test(domain))return 'ar';
  if (/\.com\.co$/.test(domain))return 'co';
  if (/\.com\.pe$/.test(domain))return 'pe';
  if (/\.com\.ve$/.test(domain))return 've';
  if (/\.com\.cl$/.test(domain))return 'cl';
  if (/\.com\.uy$/.test(domain))return 'uy';
  if (/\.com\.ec$/.test(domain))return 'ec';
  if (/\.mx$/.test(domain))     return 'mx';
  if (/\.ar$/.test(domain))     return 'ar';
  if (/\.co$/.test(domain))     return 'co';
  if (/\.pe$/.test(domain))     return 'pe';
  if (/\.cl$/.test(domain))     return 'cl';
  if (/\.de$/.test(domain))     return 'de';
  if (/\.fr$/.test(domain))     return 'fr';
  if (/\.it$/.test(domain))     return 'it';
  if (/\.pt$/.test(domain))     return 'pt';
  if (/\.br$/.test(domain))     return 'br';
  if (/\.nl$/.test(domain))     return 'nl';
  if (/\.ca$/.test(domain))     return 'ca';
  if (/\.au$/.test(domain))     return 'au';
  return 'us';
}

async function seGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Token ${API_KEY}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`SE Ranking ${path} → ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

// Month number → short name
function monthLabel(year: number, month: number): string {
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[(month - 1) % 12]} ${String(year).slice(2)}`;
}

function calcGrowthPercent(history: Array<{ traffic: number }>): string {
  if (history.length < 2) return '0';
  const first = history[0].traffic ?? 0;
  const last  = history[history.length - 1].traffic ?? 0;
  if (!first) return last > 0 ? '+100' : '0';
  const pct = Math.round(((last - first) / first) * 100);
  if (pct > 0) return `+${pct}`;
  if (pct < 0) return `${pct}`;
  return '0';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { website } = req.body as { website?: string };
  if (!website) { res.status(400).json({ error: 'website is required' }); return; }

  const domain = normalizeDomain(website);
  const source = detectSource(domain);
  const errors: string[] = [];

  // ── Worldwide overview (traffic + keyword count) ──────────────────────────
  let monthlyVisits = 0;
  let keywordsCount = 0;
  try {
    const overview = await seGet(`/v1/domain/overview/worldwide?domain=${encodeURIComponent(domain)}`) as {
      organic?: Array<{ traffic_sum?: number; keywords_count?: number }>;
    };
    const organic = overview.organic?.[0] ?? {};
    monthlyVisits = Number(organic.traffic_sum ?? 0);
    keywordsCount = Number(organic.keywords_count ?? 0);
  } catch (e: unknown) {
    errors.push(`overview: ${(e as Error).message}`);
  }

  // ── Keywords (top 5 by traffic, country-specific) ────────────────────────
  let topKeywords: Array<{ keyword: string; position: number; volume?: number }> = [];
  try {
    const kwData = await seGet(
      `/v1/domain/keywords?source=${source}&domain=${encodeURIComponent(domain)}&type=organic&limit=10&order_field=traffic&order_type=desc`,
    ) as Array<Record<string, unknown>>;
    topKeywords = kwData
      .filter(k => k.keyword)
      .map(k => ({
        keyword:  String(k.keyword ?? ''),
        position: Number(k.position ?? k.pos ?? 0),
        volume:   Number(k.volume ?? k.vol ?? 0),
      }))
      .filter(k => k.keyword)
      .slice(0, 5);
  } catch (e: unknown) {
    errors.push(`keywords: ${(e as Error).message}`);
  }

  // ── Traffic history (last 6 months) ──────────────────────────────────────
  let trafficHistory: Array<{ date: string; traffic: number }> = [];
  let trafficGrowthPercent = '0';
  try {
    const histData = await seGet(
      `/v1/domain/overview/history?source=${source}&domain=${encodeURIComponent(domain)}&type=organic`,
    ) as Array<Record<string, unknown>>;
    trafficHistory = histData
      .map(h => ({
        date:    `${h.year}${String(h.month).padStart(2, '0')}`,
        traffic: Number(h.traffic_sum ?? 0),
        year:    Number(h.year),
        month:   Number(h.month),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-6)
      .map(h => ({ date: h.date, traffic: h.traffic, year: (h as { year: number }).year, month: (h as { month: number }).month }));
    trafficGrowthPercent = calcGrowthPercent(trafficHistory);
  } catch (e: unknown) {
    errors.push(`history: ${(e as Error).message}`);
  }

  // ── Chart labels + data ───────────────────────────────────────────────────
  const chartLabels = (trafficHistory as Array<{ date: string; traffic: number; year?: number; month?: number }>)
    .map(h => {
      // date format: YYYYMM
      const year  = Number(h.date.slice(0, 4));
      const month = Number(h.date.slice(4));
      return monthLabel(year, month);
    });
  const chartData = trafficHistory.map(h => h.traffic);

  res.status(200).json({
    domain,
    monthly_visits:          monthlyVisits,
    keywords_count:          keywordsCount,
    top_keywords:            topKeywords,
    traffic_history:         trafficHistory,
    traffic_growth_percent:  trafficGrowthPercent,
    chart_labels:            chartLabels,
    chart_data:              chartData,
    errors: errors.length ? errors : undefined,
  });
}
