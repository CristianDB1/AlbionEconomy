import { parseDate, type PriceRow } from './api';
import { levelOf, type Level } from './market';
import { SETUP_FEE, taxRate, type Settings } from './settings';

export interface Recipe {
  silver: number; time: number; focus: number; out: number; v: number;
  res: [string, number, number][];   // [id, cantidad, 1 si NO devuelve recursos (artefactos...)]
  up?: [string, number];             // runa/alma/reliquia para encantar
}
export type Recipes = Record<string, Recipe[]>;

let rp: Promise<Recipes> | null = null;
export function loadRecipes(): Promise<Recipes> {
  rp ??= fetch(`${import.meta.env.BASE_URL}data/recipes.json`).then((r) => {
    if (!r.ok) throw new Error('No se pudieron cargar las recetas');
    return r.json();
  });
  return rp;
}

/** Tasa de retorno de recursos = 1 - 1/(1 + bonus/100). Bonus base 18, +40 ciudad especializada, +59 foco. */
export const rrrFrom = (bonus: number) => 1 - 1 / (1 + bonus / 100);
export const RRR_PRESETS = [
  { id: 'none', label: 'Sin bonus de ciudad', bonus: 18, focus: false },
  { id: 'city', label: 'Ciudad especializada', bonus: 58, focus: false },
  { id: 'focus', label: 'Con foco, sin bonus de ciudad', bonus: 77, focus: true },
  { id: 'cityfocus', label: 'Ciudad especializada + foco', bonus: 117, focus: true },
] as const;

export interface CraftParams {
  rrr: number;            // 0..1
  useFocus: boolean;
  feePer100: number;      // plata por cada 100 de nutrición de la estación
  matCities: string[];
  sellCities: string[];
  maxAgeHours: number;
}

export interface Ing {
  id: string; count: number; returnable: boolean;
  price: number; city: string; ageMs: number;
}
export interface CraftOpp {
  id: string; recipe: Recipe; ings: Ing[];
  matCost: number; fee: number; silver: number; cost: number;
  sellCity: string; sellGross: number; sellNet: number; revenue: number;
  profit: number; roi: number; perFocus: number | null;
  buyAge: number; sellAge: number; level: Level; suspect: boolean;
}

export function computeCraft(
  outIds: string[], recipes: Recipes, rows: PriceRow[], s: Settings, p: CraftParams,
): CraftOpp[] {
  const now = Date.now();
  const maxAge = p.maxAgeHours * 3600000;
  const tax = taxRate(s.premium);
  const idx = new Map<string, Map<string, PriceRow>>();
  for (const r of rows) {
    if (r.quality !== 1) continue;
    let m = idx.get(r.item_id);
    if (!m) idx.set(r.item_id, (m = new Map()));
    m.set(r.city, r);
  }
  const matCities = p.matCities.filter((c) => c !== 'Black Market');

  // Mejor precio de compra de un ingrediente entre las ciudades elegidas
  const bestBuy = (id: string): { price: number; city: string; ageMs: number } | null => {
    const m = idx.get(id);
    if (!m) return null;
    let best: { price: number; city: string; ageMs: number } | null = null;
    for (const c of matCities) {
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

  const out: CraftOpp[] = [];
  for (const id of outIds) {
    const recipe = recipes[id]?.[0];
    const m = idx.get(id);
    if (!recipe || !m) continue;

    // Mejor ciudad de venta
    let sell: { city: string; gross: number; net: number; ageMs: number } | null = null;
    for (const c of p.sellCities) {
      const r = m.get(c);
      if (!r) continue;
      const instant = s.sellMode === 'instant' || c === 'Black Market';
      const raw = instant ? r.buy_price_max : r.sell_price_min;
      const d = parseDate(instant ? r.buy_price_max_date : r.sell_price_min_date);
      if (raw <= 0 || d == null || now - d > maxAge) continue;
      const net = raw * (1 - tax - (instant ? 0 : SETUP_FEE));
      if (!sell || net > sell.net) sell = { city: c, gross: raw, net, ageMs: now - d };
    }
    if (!sell) continue;

    const ings: Ing[] = [];
    let ok = true;
    let matCost = 0;
    let buyAge = 0;
    for (const [rid, count, noRet] of recipe.res) {
      const b = bestBuy(rid);
      if (!b) { ok = false; break; }
      const returnable = !noRet;
      ings.push({ id: rid, count, returnable, ...b });
      matCost += b.price * count * (returnable ? 1 - p.rrr : 1);
      buyAge = Math.max(buyAge, b.ageMs);
    }
    if (!ok) continue;

    const fee = (recipe.v * 0.1125 * p.feePer100) / 100;
    const cost = matCost + fee + recipe.silver;
    const revenue = sell.net * recipe.out;
    const profit = revenue - cost;
    const roi = profit / cost;
    out.push({
      id, recipe, ings, matCost, fee, silver: recipe.silver, cost,
      sellCity: sell.city, sellGross: sell.gross, sellNet: sell.net, revenue,
      profit, roi, perFocus: p.useFocus && recipe.focus > 0 ? (profit / recipe.focus) * 1000 : null,
      buyAge, sellAge: sell.ageMs, level: levelOf(Math.max(buyAge, sell.ageMs), s), suspect: roi > 3,
    });
  }
  return out;
}
