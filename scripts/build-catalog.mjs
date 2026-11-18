// Genera public/data/catalog.json (ítems comerciables con nombres ES/EN)
// y public/data/recipes.json (recetas de crafteo/refinado) desde ao-data/ao-bin-dumps.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
mkdirSync(join(root, 'public/data'), { recursive: true });

const BASE = 'https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master';
async function load(name, url) {
  const f = join(cache, name);
  if (!existsSync(f)) {
    console.log('Descargando', url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(readFileSync(f, 'utf8'));
}

const raw = await load('items.json', `${BASE}/items.json`);
const names = await load('fitems.json', `${BASE}/formatted/items.json`);

const SECTIONS = ['simpleitem', 'consumableitem', 'consumablefrominventoryitem', 'equipmentitem',
  'weapon', 'mount', 'farmableitem', 'journalitem', 'furnitureitem', 'transformationweapon'];
const EQUIP = new Set(['equipmentitem', 'weapon', 'transformationweapon']);
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

// base uniquename -> definición
const defs = new Map();
for (const sec of SECTIONS) {
  for (const it of arr(raw.items[sec])) defs.set(it['@uniquename'], { it, sec });
}

const baseId = (id) => id.replace(/@\d+$/, '').replace(/_LEVEL\d$/, '');
const enchOf = (id) => {
  const m = id.match(/@(\d+)$/); if (m) return +m[1];
  const l = id.match(/_LEVEL(\d)$/); return l ? +l[1] : 0;
};

const catalog = [];
const catCount = {};
for (const n of names) {
  const id = n.UniqueName;
  if (!id) continue;
  const d = defs.get(baseId(id));
  if (!d || !d.it['@shopcategory']) continue;
  const cat = d.it['@shopcategory'];
  if (['hideout', 'unknown'].includes(cat)) continue;
  const sub = d.it['@shopsubcategory1'] || '';
  const tm = id.match(/^T(\d)_/);
  const tier = tm ? +tm[1] : 0;
  const en = n.LocalizedNames?.['EN-US'] || id;
  const es = n.LocalizedNames?.['ES-ES'] || en;
  catalog.push({ id, es, en, c: cat, s: sub, t: tier, e: enchOf(id), q: EQUIP.has(d.sec) ? 1 : 0 });
  catCount[cat] = (catCount[cat] || 0) + 1;
}
writeFileSync(join(root, 'public/data/catalog.json'), JSON.stringify(catalog));
console.log('catalog.json:', catalog.length, 'ítems', catCount);

// Recetas: id de catálogo (con @encantamiento) -> variantes {silver,time,focus,out,v,res:[[id,count,noReturn]],up?}
// v = valor de ítem (para la tarifa de estación: nutrición = v * 0.1125). up = coste de encantar con runas/almas/reliquias.
const baseVal = (uname) => {
  const d = defs.get(uname);
  const v = d && +d.it['@itemvalue'];
  return v > 0 ? v : 0;
};
const valueOf = (resId) => {
  const direct = baseVal(resId.replace(/@d+$/, '')); // p. ej. T4_WOOD_LEVEL1 ya trae su propio valor
  return direct || baseVal(baseId(resId)) * Math.pow(2, enchOf(resId));
};
const resId = (r) => {
  const n = r['@uniquename'];
  const lvl = +(r['@enchantmentlevel'] || 0);
  return lvl > 0 && !n.includes('@') ? `${n}@${lvl}` : n;
};
const catIds = new Set(catalog.map((c) => c.id));
const recipes = {};
function addRecipes(outId, it, reqs, up, mult = 1) {
  for (const cr of arr(reqs)) {
    const res = arr(cr.craftresource).map((r) => [resId(r), +r['@count'], r['@maxreturnamount'] === '0' ? 1 : 0]);
    if (!res.length) continue;
    if (res.some(([id]) => /FACTION|JOURNAL/.test(id))) continue; // variantes con fichas de facción/diarios
    const own = +(it['@itemvalue'] || 0) * mult;
    const v = own || res.reduce((a, [id, n]) => a + valueOf(id) * n, 0);
    const out = +(cr['@amountcrafted'] || 1);
    (recipes[outId] ||= []).push({
      silver: +(cr['@silver'] || 0), time: +(cr['@time'] || 0), focus: +(cr['@craftingfocus'] || 0),
      out, v: Math.round(v * 100) / 100, res, ...(up ? { up } : {}),
    });
  }
}
for (const [uname, { it }] of defs) {
  const lvl0 = enchOf(uname);
  const id0 = lvl0 > 0 && !uname.includes('@') ? `${uname}@${lvl0}` : uname;
  addRecipes(id0, it, it.craftingrequirements);
  for (const en of arr(it.enchantments?.enchantment)) {
    const lvl = +en['@enchantmentlevel'];
    const ur = en.upgraderequirements?.upgraderesource;
    addRecipes(`${uname}@${lvl}`, it, en.craftingrequirements, ur ? [ur['@uniquename'], +ur['@count']] : undefined, Math.pow(2, lvl));
  }
}
writeFileSync(join(root, 'public/data/recipes.json'), JSON.stringify(recipes));
const ids = Object.keys(recipes);
const inCat = ids.filter((i) => catIds.has(i)).length;
const missingRes = new Set();
for (const v of Object.values(recipes)) for (const r of v) for (const [id] of r.res) if (!catIds.has(id)) missingRes.add(id);
console.log('recipes.json:', ids.length, 'ítems con receta;', inCat, 'están en catálogo; ingredientes fuera de catálogo:', missingRes.size, [...missingRes].slice(0, 8));
