import { fetchPrices, type PriceRow } from './api';
import type { CatItem } from './catalog';
import type { ServerKey } from './settings';

// Los precios se descargan en segundo plano (GitHub Actions) y se publican como archivos estáticos.
// Formato por fila: [id, idxCiudad, calidad, sellMin, sellMinTs, buyMax, buyMaxTs] (ts en segundos, 0 = sin dato).
type SnapRow = [string, number, number, number, number, number, number];
interface Meta { server: string; cities: string[]; updatedAt: number; cats: Record<string, { rows: number; t: number }> }
interface CatFile { t: number; rows: SnapRow[] }

const base = () => `${import.meta.env.BASE_URL}data/prices/`;
const files = new Map<string, Promise<CatFile | null>>();
let metaP: Promise<Meta | null> | null = null;

async function getJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(base() + name, { cache: 'no-cache' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('text/html')) return null; // el servidor devolvió index.html por una ruta inexistente
    return (await r.json()) as T;
  } catch { return null; }
}

export const snapshotMeta = () => (metaP ??= getJson<Meta>('meta.json'));
const catFile = (c: string) => {
  let p = files.get(c);
  if (!p) files.set(c, (p = getJson<CatFile>(`${c}.json`)));
  return p;
};

const iso = (s: number) => (s ? new Date(s * 1000).toISOString().slice(0, 19) : '0001-01-01T00:00:00');

export interface DataResult { rows: PriceRow[]; source: 'snapshot' | 'live'; updatedAt: number }

/**
 * Obtiene precios. Usa el snapshot publicado cuando existe (sin gastar cupo de la API) y cae a consulta
 * en vivo si no hay snapshot, si piden otra calidad/servidor, o si `live` es true.
 */
export async function getPrices(opts: {
  server: ServerKey; ids: string[]; cities: string[]; qualities: number[]; live: boolean;
  catalog: CatItem[]; onProgress?: (d: number, t: number) => void; signal?: AbortSignal;
}): Promise<DataResult> {
  const { server, ids, cities, qualities, live, catalog, onProgress, signal } = opts;
  const meta = live ? null : await snapshotMeta();
  const usable = meta && meta.server === server && qualities.length === 1 && qualities[0] === 1;
  if (usable && meta) {
    const catOf = new Map(catalog.map((i) => [i.id, i.c]));
    const need = new Set<string>();
    for (const id of ids) need.add(catOf.get(id) ?? 'other');
    const wanted = new Set(ids);
    const cityOk = new Set(cities);
    const rows: PriceRow[] = [];
    let oldest = Infinity;
    let ok = true;
    for (const c of need) {
      const f = await catFile(c);
      if (!f) { if (meta.cats[c]) { ok = false; break; } continue; }
      oldest = Math.min(oldest, f.t);
      for (const r of f.rows) {
        if (!wanted.has(r[0])) continue;
        const city = meta.cities[r[1]];
        if (!cityOk.has(city)) continue;
        rows.push({
          item_id: r[0], city, quality: r[2],
          sell_price_min: r[3], sell_price_min_date: iso(r[4]), sell_price_max: 0, sell_price_max_date: iso(0),
          buy_price_min: 0, buy_price_min_date: iso(0), buy_price_max: r[5], buy_price_max_date: iso(r[6]),
        });
      }
    }
    if (ok) return { rows, source: 'snapshot', updatedAt: (isFinite(oldest) ? oldest : meta.updatedAt) * 1000 };
  }
  const rows = await fetchPrices(server, ids, cities, qualities, onProgress, signal);
  return { rows, source: 'live', updatedAt: Date.now() };
}
