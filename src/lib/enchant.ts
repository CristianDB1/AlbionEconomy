import { parseDate, type PriceRow } from './api';
import type { Recipes } from './craft';
import { levelOf, type Level } from './market';
import { SETUP_FEE, taxRate, type Settings } from './settings';

export type EnchKind = 'item' | 'res';

/** Niveles máximos con datos verificados: ítems .0→.3 (runa, alma, reliquia). El paso a .4 no trae cantidad en los datos del juego. */
export const MAX_ITEM_LEVEL = 3;
export const MAX_RES_LEVEL = 4;

export interface Step { id: string; count: number; price: number; city: string; ageMs: number; silver: number; to: number }
export interface EnchOpp {
  kind: EnchKind;
  base: string;          // id del ítem sin encantar (T4_MAIN_SWORD) o del recurso (T4_WOOD)
  from: number; to: number;
  srcId: string; dstId: string;
  srcPrice: number; srcCity: string; srcAge: number;
  steps: Step[];
  matCost: number;       // runas/almas/reliquias
  silver: number;        // plata de transmutación (recursos)
  cost: number;          // todo lo que pagas
  sellCity: string; sellGross: number; sellNet: number; sellAge: number;
  profit: number; roi: number;
  level: Level; suspect: boolean;
  alts: { from: number; to: number; profit: number; roi: number }[];
}

export interface EnchParams { buyCities: string[]; sellCities: string[]; maxAgeHours: number; kind: EnchKind }

export const encId = (base: string, lvl: number, kind: EnchKind) =>
  lvl === 0 ? base : kind === 'item' ? `${base}@${lvl}` : `${base}_LEVEL${lvl}@${lvl}`;

/** Ids de precios necesarios para evaluar esta lista de bases. */
export function enchantIds(bases: string[], recipes: Recipes, kind: EnchKind): string[] {
  const out = new Set<string>();
  const max = kind === 'item' ? MAX_ITEM_LEVEL : MAX_RES_LEVEL;
  for (const b of bases) {
    for (let l = 0; l <= max; l++) {
      const id = encId(b, l, kind);
      out.add(id);
      const up = recipes[id]?.[0]?.up;
      if (kind === 'item' && up) out.add(up[0]);
    }
  }
  return [...out];
}

export function computeEnchant(
  bases: string[], recipes: Recipes, rows: PriceRow[], s: Settings, p: EnchParams,
): EnchOpp[] {
  const now = Date.now();
  const maxAge = p.maxAgeHours * 3600000;
  const tax = taxRate(s.premium);
  const kind = p.kind;
  const max = kind === 'item' ? MAX_ITEM_LEVEL : MAX_RES_LEVEL;
  const buyCities = p.buyCities.filter((c) => c !== 'Black Market');
  const idx = new Map<string, Map<string, PriceRow>>();
  for (const r of rows) {
    if (r.quality !== 1) continue;
    let m = idx.get(r.item_id);
    if (!m) idx.set(r.item_id, (m = new Map()));
    m.set(r.city, r);
  }

  const bestBuy = (id: string) => {
    const m = idx.get(id);
    if (!m) return null;
    let best: { price: number; city: string; ageMs: number } | null = null;
    for (const c of buyCities) {
      const r = m.get(c);
      if (!r) continue;
      const raw = s.buyMode === 'instant' ? r.sell_price_min : r.buy_price_max;
      const d = parseDate(s.buyMode === 'instant' ? r.sell_price_min_date : r.buy_price_max_date);
      if (raw <= 0 || d == null || now - d > maxAge) continue;
      const price = s.buyMode === 'instant' ? raw : raw * (1 + SETUP_FEE);
      if (!best || price < best.price) best = { price, city: c, ageMs: now - d };
    }
    return best;
  };
  const bestSell = (id: string) => {
    const m = idx.get(id);
    if (!m) return null;
    let best: { city: string; gross: number; net: number; ageMs: number } | null = null;
    for (const c of p.sellCities) {
      const r = m.get(c);
      if (!r) continue;
      const instant = s.sellMode === 'instant' || c === 'Black Market';
      const raw = instant ? r.buy_price_max : r.sell_price_min;
      const d = parseDate(instant ? r.buy_price_max_date : r.sell_price_min_date);
      if (raw <= 0 || d == null || now - d > maxAge) continue;
      const net = raw * (1 - tax - (instant ? 0 : SETUP_FEE));
      if (!best || net > best.net) best = { city: c, gross: raw, net, ageMs: d ? now - d : 0 };
    }
    return best;
  };

  const out: EnchOpp[] = [];
  for (const base of bases) {
    // Datos de cada paso a→a+1…: ítems = runas/almas/reliquias; recursos = plata
    const stepInfo: ({ up?: [string, number]; silver: number } | null)[] = [];
    for (let l = 1; l <= max; l++) {
      const rc = recipes[encId(base, l, kind)]?.[0];
      if (!rc) { stepInfo[l] = null; continue; }
      if (kind === 'item') stepInfo[l] = rc.up ? { up: rc.up, silver: 0 } : null;
      else stepInfo[l] = rc.silver > 0 ? { silver: rc.silver } : null;
    }
    const combos: EnchOpp[] = [];
    for (let a = 0; a < max; a++) {
      const srcId = encId(base, a, kind);
      const src = bestBuy(srcId);
      if (!src) continue;
      const steps: Step[] = [];
      let matCost = 0, silver = 0, worstBuy = src.ageMs, ok = true;
      for (let b = a + 1; b <= max; b++) {
        const st = stepInfo[b];
        if (!st) { ok = false; break; }
        if (st.up) {
          const mp = bestBuy(st.up[0]);
          if (!mp) { ok = false; break; }
          steps.push({ id: st.up[0], count: st.up[1], price: mp.price, city: mp.city, ageMs: mp.ageMs, silver: 0, to: b });
          matCost += mp.price * st.up[1];
          worstBuy = Math.max(worstBuy, mp.ageMs);
        } else {
          steps.push({ id: '', count: 0, price: 0, city: '', ageMs: 0, silver: st.silver, to: b });
          silver += st.silver;
        }
        const dstId = encId(base, b, kind);
        const sell = bestSell(dstId);
        if (!sell) continue;
        const cost = src.price + matCost + silver;
        const profit = sell.net - cost;
        combos.push({
          kind, base, from: a, to: b, srcId, dstId, srcPrice: src.price, srcCity: src.city, srcAge: src.ageMs,
          steps: steps.map((x) => ({ ...x })), matCost, silver, cost,
          sellCity: sell.city, sellGross: sell.gross, sellNet: sell.net, sellAge: sell.ageMs,
          profit, roi: profit / cost, level: levelOf(Math.max(worstBuy, sell.ageMs), s), suspect: profit / cost > 3, alts: [],
        });
      }
      if (!ok) continue;
    }
    if (!combos.length) continue;
    combos.sort((x, y) => y.profit - x.profit);
    const best = combos[0];
    best.alts = combos.slice(0, 8).map((c) => ({ from: c.from, to: c.to, profit: c.profit, roi: c.roi }));
    out.push(best);
  }
  return out;
}
