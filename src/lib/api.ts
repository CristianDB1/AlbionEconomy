import type { ServerKey } from './settings';

export const HOSTS: Record<ServerKey, string> = {
  west: 'https://west.albion-online-data.com',   // Américas
  east: 'https://east.albion-online-data.com',   // Asia
  europe: 'https://europe.albion-online-data.com',
};
export const SERVER_LABEL: Record<ServerKey, string> = { west: 'Américas', east: 'Asia', europe: 'Europa' };

export interface PriceRow {
  item_id: string; city: string; quality: number;
  sell_price_min: number; sell_price_min_date: string;
  sell_price_max: number; sell_price_max_date: string;
  buy_price_min: number; buy_price_min_date: string;
  buy_price_max: number; buy_price_max_date: string;
}
export interface HistoryRow {
  location: string; item_id: string; quality: number;
  data: { item_count: number; avg_price: number; timestamp: string }[];
}

/** La API devuelve fechas UTC sin "Z"; "0001-01-01" significa "sin dato". */
export function parseDate(s: string | undefined): number | null {
  if (!s || s.startsWith('0001')) return null;
  const t = Date.parse(s.endsWith('Z') ? s : s + 'Z');
  return Number.isNaN(t) ? null : t;
}

// --- Limitador: la API permite 100 peticiones/min y 300 cada 5 min por IP. Dejamos margen (90 y 270). ---
const MAX_CONCURRENT = 3;
const LIMITS = [{ windowMs: 60_000, max: 90 }, { windowMs: 300_000, max: 270 }];
const starts: number[] = [];
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (starts.length && now - starts[0] > 300_000) starts.shift();
    let wait = 0;
    for (const { windowMs, max } of LIMITS) {
      const inWin = starts.filter((t) => now - t < windowMs);
      if (inWin.length >= max) wait = Math.max(wait, inWin[inWin.length - max] + windowMs - now);
    }
    if (wait <= 0 && active < MAX_CONCURRENT) { starts.push(now); active++; return; }
    if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
    else await new Promise((r) => setTimeout(r, wait + 20));
  }
}
function release() { active--; waiters.shift()?.(); }
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try { return await fn(); } finally { release(); }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await slot(() => fetch(url, { signal }));
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 30_000)); throw new Error('Límite de la API alcanzado (HTTP 429)'); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Error de red');
}

const cache = new Map<string, { t: number; rows: PriceRow[] }>();
const TTL = 3 * 60 * 1000;
const BATCH = 150;

export const requestsFor = (nItems: number) => Math.ceil(nItems / BATCH);

export async function fetchPrices(
  server: ServerKey, ids: string[], cities: string[], qualities: number[],
  onProgress?: (done: number, total: number) => void, signal?: AbortSignal,
): Promise<PriceRow[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  let done = 0;
  const out: PriceRow[] = [];
  await Promise.all(batches.map(async (b) => {
    const url = `${HOSTS[server]}/api/v2/stats/prices/${b.join(',')}.json?locations=${encodeURIComponent(cities.join(','))}&qualities=${qualities.join(',')}`;
    const hit = cache.get(url);
    let rows: PriceRow[];
    if (hit && Date.now() - hit.t < TTL) rows = hit.rows;
    else { rows = await getJson<PriceRow[]>(url, signal); cache.set(url, { t: Date.now(), rows }); }
    out.push(...rows);
    onProgress?.(++done, batches.length);
  }));
  return out;
}

const histCache = new Map<string, { t: number; rows: HistoryRow[] }>();
export async function fetchHistory(server: ServerKey, id: string, cities: string[], quality: number, signal?: AbortSignal) {
  const url = `${HOSTS[server]}/api/v2/stats/history/${id}.json?locations=${encodeURIComponent(cities.join(','))}&qualities=${quality}&time-scale=24`;
  const hit = histCache.get(url);
  if (hit && Date.now() - hit.t < 10 * 60_000) return hit.rows;
  const rows = await getJson<HistoryRow[]>(url, signal);
  histCache.set(url, { t: Date.now(), rows });
  return rows;
}

export const iconUrl = (id: string, quality = 1, size = 64) =>
  `https://render.albiononline.com/v1/item/${id}.png?size=${size}&quality=${quality}`;
