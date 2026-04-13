import type { VercelRequest, VercelResponse } from '@vercel/node';

const BASE = process.env.SE_RANKING_BASE_URL ?? 'https://api.seranking.com';
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

function detectSource(domain: string): string {
  if (/\.es$/.test(domain))      return 'es';
  if (/\.co\.uk$/.test(domain))  return 'uk';
  if (/\.com\.mx$/.test(domain)) return 'mx';
  if (/\.com\.ar$/.test(domain)) return 'ar';
  if (/\.com\.co$/.test(domain)) return 'co';
  if (/\.com\.pe$/.test(domain)) return 'pe';
  if (/\.com\.ve$/.test(domain)) return 've';
  if (/\.com\.cl$/.test(domain)) return 'cl';
  if (/\.com\.uy$/.test(domain)) return 'uy';
  if (/\.com\.ec$/.test(domain)) return 'ec';
  if (/\.mx$/.test(domain))      return 'mx';
  if (/\.ar$/.test(domain))      return 'ar';
  if (/\.co$/.test(domain))      return 'co';
  if (/\.pe$/.test(domain))      return 'pe';
  if (/\.cl$/.test(domain))      return 'cl';
  if (/\.de$/.test(domain))      return 'de';
  if (/\.fr$/.test(domain))      return 'fr';
  if (/\.it$/.test(domain))      return 'it';
  if (/\.pt$/.test(domain))      return 'pt';
  if (/\.br$/.test(domain))      return 'br';
  if (/\.nl$/.test(domain))      return 'nl';
  if (/\.ca$/.test(domain))      return 'ca';
  if (/\.au$/.test(domain))      return 'au';
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

function monthLabel(year: number, month: number): string {
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${months[(month - 1) % 12]} ${String(year).slice(2)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(200).json({ ok: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  if (!API_KEY) {
    res.status(500).json({ error: 'SE_RANKING_API_KEY no está configurado en las variables de entorno.' });
    return;
  }

  const { websiteUrl } = req.body as { websiteUrl?: string; businessName?: string };
  if (!websiteUrl) { res.status(400).json({ error: 'websiteUrl is required' }); return; }

  const domain = normalizeDomain(websiteUrl);
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

  // ── Traffic history — last 6 months ──────────────────────────────────────
  let monthlyVisitsLast6Months: number[] = [];
  let chartLabels: string[] = [];
  try {
    const histData = await seGet(
      `/v1/domain/overview/history?source=${source}&domain=${encodeURIComponent(domain)}&type=organic`,
    ) as Array<Record<string, unknown>>;

    const sorted = histData
      .map(h => ({
        key:     `${h.year}${String(h.month).padStart(2, '0')}`,
        traffic: Number(h.traffic_sum ?? 0),
        year:    Number(h.year),
        month:   Number(h.month),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-6);

    monthlyVisitsLast6Months = sorted.map(h => h.traffic);
    chartLabels = sorted.map(h => monthLabel(h.year, h.month));

    // Pad to exactly 6 if fewer months returned
    if (monthlyVisitsLast6Months.length > 0 && monthlyVisitsLast6Months.length < 6) {
      const base = monthlyVisits || monthlyVisitsLast6Months[monthlyVisitsLast6Months.length - 1];
      while (monthlyVisitsLast6Months.length < 6) {
        monthlyVisitsLast6Months.unshift(Math.round(base * 0.85));
        chartLabels.unshift('—');
      }
    }

    if (monthlyVisitsLast6Months.length === 0) {
      // Fallback: synthesise from monthly_visits
      const base = monthlyVisits;
      monthlyVisitsLast6Months = [0.72, 0.79, 0.86, 0.92, 0.97, 1].map(f => Math.round(base * f));
    }
  } catch (e: unknown) {
    errors.push(`history: ${(e as Error).message}`);
    // Fallback series so estimateTrafficGrowthPercentage always gets 6 values
    const base = monthlyVisits;
    monthlyVisitsLast6Months = [0.72, 0.79, 0.86, 0.92, 0.97, 1].map(f => Math.round(base * f));
  }

  res.status(200).json({
    domain,
    monthly_visits:              monthlyVisits,
    monthly_visits_last_6_months: monthlyVisitsLast6Months,
    keywords_count:              keywordsCount,
    chart_labels:                chartLabels,
    chart_data:                  monthlyVisitsLast6Months,
    // Speed/health not available via SE Ranking overview; Gemini/PPT defaults to 0
    site_speed_score:            0,
    technical_health_score:      0,
    errors: errors.length ? errors : undefined,
  });
}
