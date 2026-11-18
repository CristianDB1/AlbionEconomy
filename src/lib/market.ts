import { parseDate, type PriceRow } from './api';
import { SETUP_FEE, taxRate, type Settings } from './settings';

export type Level = 'fresh' | 'warn' | 'stale';

export interface Opp {
  id: string;
  q: number;
  from: string;
  to: string;
  cost: number;        // lo que pagas por unidad (incluye tarifa si pones orden de compra)
  sellGross: number;   // precio de venta bruto
  sellNet: number;     // lo que recibes tras impuesto (y tarifa si publicas orden)
  profit: number;
  roi: number;
  buyAge: number;      // ms
  sellAge: number;     // ms
  level: Level;
  suspect: boolean;    // ROI exageradamente alto: probablemente dato erróneo/manipulado
  prices: Map<string, PriceRow>;
}

export function levelOf(ageMs: number, s: Settings): Level {
  const h = ageMs / 3600000;
  return h <= s.freshHours ? 'fresh' : h <= s.staleHours ? 'warn' : 'stale';
}

export interface OppOptions { maxAgeHours: number; cities: string[] }

export function computeOpps(rows: PriceRow[], s: Settings, opt: OppOptions): Opp[] {
  const now = Date.now();
  const tax = taxRate(s.premium);
  const byItem = new Map<string, Map<string, PriceRow>>();
  for (const r of rows) {
    if (!opt.cities.includes(r.city)) continue;
    const k = `${r.item_id}|${r.quality}`;
    let m = byItem.get(k);
    if (!m) byItem.set(k, (m = new Map()));
    m.set(r.city, r);
  }
  const maxAge = opt.maxAgeHours * 3600000;
  const out: Opp[] = [];

  for (const [k, prices] of byItem) {
    const [id, qs] = k.split('|');
    let best: Opp | null = null;

    for (const [from, a] of prices) {
      if (from === 'Black Market') continue; // en el Mercado Negro no se compra
      const buyRaw = s.buyMode === 'instant' ? a.sell_price_min : a.buy_price_max;
      const buyDate = parseDate(s.buyMode === 'instant' ? a.sell_price_min_date : a.buy_price_max_date);
      if (buyRaw <= 0 || buyDate == null) continue;
      const buyAge = now - buyDate;
      if (buyAge > maxAge) continue;
      const cost = s.buyMode === 'instant' ? buyRaw : buyRaw * (1 + SETUP_FEE);

      for (const [to, b] of prices) {
        if (to === from) continue;
        // El Mercado Negro solo tiene órdenes de compra: venta instantánea obligatoria.
        const instant = s.sellMode === 'instant' || to === 'Black Market';
        const sellRaw = instant ? b.buy_price_max : b.sell_price_min;
        const sellDate = parseDate(instant ? b.buy_price_max_date : b.sell_price_min_date);
        if (sellRaw <= 0 || sellDate == null) continue;
        const sellAge = now - sellDate;
        if (sellAge > maxAge) continue;
        const sellNet = sellRaw * (1 - tax - (instant ? 0 : SETUP_FEE));
        const profit = sellNet - cost;
        if (!best || profit > best.profit) {
          const worst = Math.max(buyAge, sellAge);
          const roi = profit / cost;
          best = {
            id, q: +qs, from, to, cost, sellGross: sellRaw, sellNet, profit, roi,
            buyAge, sellAge, level: levelOf(worst, s), suspect: roi > 3, prices,
          };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}
