// Descarga los precios de Albion Online Data Project y los guarda como archivos estáticos por categoría
// en public/data/prices/. Pensado para correr en GitHub Actions cada ~10 min.
//
//  · Ítems "calientes" (T4-T8 sin encantar + ingredientes de sus recetas): en cada corrida.
//  · Catálogo completo (sin cosméticos/mobiliario/otros): cuando el último barrido tiene más de FULL_EVERY_MIN.
//  · Si la API falla, se conserva el dato anterior (PREV_BASE = URL del sitio ya publicado) y el script NO falla.
//
// Variables: SERVER (west|east|europe, def. west), PREV_BASE, FULL_EVERY_MIN (def. 90), FORCE_FULL=1
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/data/prices');
mkdirSync(out, { recursive: true });

const SERVER = process.env.SERVER || 'west';
const HOST = { west: 'west', east: 'east', europe: 'europe' }[SERVER] || 'west';
const BASE = process.env.API_BASE || `https://${HOST}.albion-online-data.com`;
const PREV = (process.env.PREV_BASE || '').replace(/\/$/, '');
const FULL_EVERY = (+process.env.FULL_EVERY_MIN || 90) * 60_000;
const CITIES = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien', 'Black Market'];
const SKIP = new Set(['vanity', 'other', 'furniture']);
const HOT_CATS = new Set(['weapons', 'armors', 'head', 'shoes', 'capes', 'offhands', 'bags', 'mounts', 'consumables', 'crafting', 'artefacts', 'gathering']);
const BATCH = 150;

const catalog = JSON.parse(readFileSync(join(root, 'public/data/catalog.json'), 'utf8'));
const recipes = JSON.parse(readFileSync(join(root, 'public/data/recipes.json'), 'utf8'));
const catOf = new Map(catalog.map((i) => [i.id, i.c]));

async function getPrev(name) {
  if (!PREV) return null;
  try {
    const r = await fetch(`${PREV}/data/prices/${name}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const prevMeta = (await getPrev('meta.json')) || { fullAt: 0, cats: {} };
const now = Date.now();
const doFull = process.env.FORCE_FULL === '1' || now - (prevMeta.fullAt || 0) > FULL_EVERY;

// Conjuntos de ids
const hot = new Set();
for (const i of catalog) {
  if (!SKIP.has(i.c) && i.t >= 4 && i.t <= 8 && HOT_CATS.has(i.c) && i.e === 0) {
    hot.add(i.id);
    for (const [rid] of recipes[i.id]?.[0]?.res ?? []) hot.add(rid);
  }
}
const full = new Set(catalog.filter((i) => !SKIP.has(i.c)).map((i) => i.id));
for (const id of hot) full.add(id);
const ids = [...(doFull ? full : hot)].sort();
console.log(`${doFull ? 'Barrido completo' : 'Corrida rápida'}: ${ids.length} ítems, ${Math.ceil(ids.length / BATCH)} peticiones (${SERVER})`);

// --- Limitador (100/min y 300/5 min por IP; usamos margen) ---
const starts = [];
async function gate() {
  if (process.env.NO_THROTTLE) return;
  for (;;) {
    const t = Date.now();
    while (starts.length && t - starts[0] > 300_000) starts.shift();
    let wait = 0;
    for (const [win, max] of [[60_000, 85], [300_000, 260]]) {
      const w = starts.filter((s) => t - s < win);
      if (w.length >= max) wait = Math.max(wait, w[w.length - max] + win - t);
    }
    if (wait <= 0) { starts.push(t); return; }
    await new Promise((r) => setTimeout(r, wait + 50));
  }
}

async function getJson(url) {
  let err;
  for (let a = 0; a < 4; a++) {
    await gate();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'AlbionEconomy-sync', 'Accept-Encoding': 'gzip' } });
      if (r.status === 429) { await new Promise((x) => setTimeout(x, 60_000)); throw new Error('HTTP 429'); }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; await new Promise((x) => setTimeout(x, 2000 * (a + 1))); }
  }
  throw err;
}

// Fecha de la API (UTC sin Z) -> segundos epoch; 0 = sin dato
const ts = (s) => (!s || s.startsWith('0001') ? 0 : Math.floor(Date.parse(s.endsWith('Z') ? s : s + 'Z') / 1000));

// --- Descarga ---
const rows = []; // [id, ciudad(idx), calidad, sellMin, sellMinTs, buyMax, buyMaxTs]
let failed = 0, consecutive = 0, okBatches = 0;
const batches = [];
for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
let next = 0, done = 0;
await Promise.all([0, 1, 2].map(async () => {
  while (next < batches.length) {
    if (consecutive >= 5 && okBatches === 0) { next = batches.length; break; } // la API no responde: no insistir
    const b = batches[next++];
    const url = `${BASE}/api/v2/stats/prices/${b.join(',')}.json?locations=${encodeURIComponent(CITIES.join(','))}&qualities=1`;
    try {
      for (const r of await getJson(url)) {
        const ci = CITIES.indexOf(r.city);
        if (ci < 0 || r.quality !== 1) continue;
        if (r.sell_price_min <= 0 && r.buy_price_max <= 0) continue;
        rows.push([r.item_id, ci, 1, r.sell_price_min, ts(r.sell_price_min_date), r.buy_price_max, ts(r.buy_price_max_date)]);
      }
      consecutive = 0; okBatches++;
    } catch (e) { failed++; consecutive++; console.warn('Lote fallido:', e.message); }
    if (++done % 10 === 0) console.log(`${done}/${batches.length}`);
  }
}));

if (okBatches === 0 || failed > batches.length / 2) {
  console.error(`Demasiados lotes fallidos (${failed}/${batches.length}): se conserva el dato anterior.`);
  // Reutiliza lo publicado para que el sitio no pierda datos
  for (const f of ['meta.json', ...Object.keys(prevMeta.cats || {}).map((c) => `${c}.json`)]) {
    const p = await getPrev(f);
    if (p) writeFileSync(join(out, f), JSON.stringify(p));
  }
  process.exit(0);
}

// --- Fusión por categoría: lo nuevo reemplaza a lo viejo de esos ids; el resto se conserva ---
const fetched = new Set(ids);
const byCat = {};
for (const r of rows) (byCat[catOf.get(r[0]) ?? 'other'] ||= []).push(r);
const metaCats = { ...(prevMeta.cats || {}) };
const catsTouched = new Set([...ids.map((i) => catOf.get(i) ?? 'other')]);
for (const c of catsTouched) {
  const prev = await getPrev(`${c}.json`);
  const kept = (prev?.rows ?? []).filter((r) => !fetched.has(r[0]));
  const merged = [...kept, ...(byCat[c] ?? [])];
  writeFileSync(join(out, `${c}.json`), JSON.stringify({ t: Math.floor(now / 1000), rows: merged }));
  metaCats[c] = { rows: merged.length, t: Math.floor(now / 1000) };
}
// Categorías no tocadas en esta corrida: copiar el archivo anterior para que sigan publicadas
for (const c of Object.keys(prevMeta.cats || {})) {
  if (catsTouched.has(c)) continue;
  const p = await getPrev(`${c}.json`);
  if (p) writeFileSync(join(out, `${c}.json`), JSON.stringify(p));
}
writeFileSync(join(out, 'meta.json'), JSON.stringify({
  server: SERVER, cities: CITIES, updatedAt: Math.floor(now / 1000),
  fullAt: doFull ? now : prevMeta.fullAt || 0, cats: metaCats,
}));
console.log(`Listo: ${rows.length} filas, ${failed} lotes fallidos.`);
