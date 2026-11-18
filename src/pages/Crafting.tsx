import { useEffect, useMemo, useRef, useState } from 'react';
import { requestsFor, type PriceRow } from '../lib/api';
import { getPrices } from '../lib/store';
import { CATEGORY_LABEL, CITIES, cityName, loadCatalog, type CatItem } from '../lib/catalog';
import {
  RRR_PRESETS, computeCraft, loadRecipes, rrrFrom, type CraftOpp, type Recipes,
} from '../lib/craft';
import { ageText, fmt, pct } from '../lib/format';
import { usePersisted, useSettings } from '../lib/settings';
import { Chip, Fresh, ItemIcon, toggle } from '../components/bits';
import { HistoryToggle } from '../components/PriceHistory';

const MAX_REQUESTS = 150;
const CRAFT_CATS = ['weapons', 'armors', 'head', 'shoes', 'capes', 'offhands', 'bags', 'mounts', 'consumables'];
type SortKey = 'profit' | 'roi' | 'cost' | 'focus';

const REFINE_HINT = 'Bonus de refinado por ciudad: Fort Sterling → tablas · Lymhurst → tela · Martlock → cuero · Thetford → lingotes · Bridgewatch → piedra.';

export default function Crafting({ mode }: { mode: 'craft' | 'refine' }) {
  const refine = mode === 'refine';
  const { s } = useSettings();
  const k = (n: string) => `${mode}.${n}`;

  const [catalog, setCatalog] = useState<CatItem[]>([]);
  const [recipes, setRecipes] = useState<Recipes>({});
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    Promise.all([loadCatalog(), loadRecipes()]).then(([c, r]) => { setCatalog(c); setRecipes(r); })
      .catch((e) => setLoadErr(String(e.message || e)));
  }, []);

  // Filtros de escaneo
  const [cats, setCats] = useState(new Set(CRAFT_CATS));
  const [tiers, setTiers] = useState(new Set([4, 5, 6, 7, 8]));
  const [ench, setEnch] = useState(new Set([0]));
  const [query, setQuery] = useState('');
  const [matCities, setMatCities] = usePersisted<string[]>(k('mat'), CITIES.filter((c) => c !== 'Black Market'));
  const [sellCities, setSellCities] = usePersisted<string[]>(k('sell'), refine ? CITIES.filter((c) => c !== 'Black Market') : CITIES);

  // Parámetros de producción
  const [preset, setPreset] = usePersisted(k('preset'), 'city');
  const [customRrr, setCustomRrr] = usePersisted(k('custom'), 40);
  const [useCustomFocus, setUseCustomFocus] = usePersisted(k('customfocus'), false);
  const [fee, setFee] = usePersisted(k('fee'), 300);

  // Resultado
  const [maxAge, setMaxAge] = useState(24);
  const [minProfit, setMinProfit] = useState(0);
  const [minRoi, setMinRoi] = useState(3);
  const [sort, setSort] = useState<SortKey>('profit');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);

  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [scanIds, setScanIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  const [err, setErr] = useState('');
  const [scannedAt, setScannedAt] = useState(0);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<'snapshot' | 'live'>('snapshot');
  const abort = useRef<AbortController | null>(null);

  const rrrInfo = useMemo(() => {
    if (preset === 'custom') return { rrr: customRrr / 100, focus: useCustomFocus };
    const p = RRR_PRESETS.find((x) => x.id === preset) ?? RRR_PRESETS[1];
    return { rrr: rrrFrom(p.bonus), focus: p.focus };
  }, [preset, customRrr, useCustomFocus]);

  const outputs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((i) => recipes[i.id] && tiers.has(i.t) && ench.has(i.e) &&
      (refine ? i.c === 'crafting' && i.s === 'refinedresources' : cats.has(i.c)) &&
      (!q || i.es.toLowerCase().includes(q) || i.en.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)));
  }, [catalog, recipes, cats, tiers, ench, query, refine]);

  const names = useMemo(() => new Map(catalog.map((i) => [i.id, i])), [catalog]);
  const allIds = useMemo(() => {
    const set = new Set<string>();
    for (const o of outputs) {
      set.add(o.id);
      for (const [rid] of recipes[o.id][0].res) set.add(rid);
    }
    return [...set];
  }, [outputs, recipes]);
  const nReq = requestsFor(allIds.length);
  const willBeLive = live || s.server !== 'west';
  const tooMany = willBeLive && nReq > MAX_REQUESTS;
  const canScan = !busy && outputs.length > 0 && !tooMany && matCities.length > 0 && sellCities.length > 0;

  async function scan() {
    if (!canScan) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy(true); setErr(''); setProg([0, nReq]); setOpen(null); setLimit(100);
    const ids = outputs.map((o) => o.id);
    try {
      const cities = [...new Set([...matCities, ...sellCities])];
      const res = await getPrices({
        server: s.server, ids: allIds, cities, qualities: [1], live, catalog,
        onProgress: (d, t) => setProg([d, t]), signal: ac.signal,
      });
      setRows(res.rows); setScanIds(ids); setScannedAt(res.updatedAt); setSource(res.source);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(`No se pudo consultar la API: ${(e as Error).message}`);
    } finally { if (abort.current === ac) setBusy(false); }
  }

  const opps = useMemo(() => {
    if (!rows) return [];
    const list = computeCraft(scanIds, recipes, rows, s, {
      rrr: rrrInfo.rrr, useFocus: rrrInfo.focus, feePer100: fee, matCities, sellCities, maxAgeHours: maxAge,
    }).filter((o) => o.profit >= minProfit && o.roi * 100 >= minRoi);
    const key: Record<SortKey, (o: CraftOpp) => number> = {
      profit: (o) => -o.profit, roi: (o) => -o.roi, cost: (o) => o.cost, focus: (o) => -(o.perFocus ?? -Infinity),
    };
    return list.sort((a, b) => key[sort](a) - key[sort](b));
  }, [rows, scanIds, recipes, s, rrrInfo, fee, matCities, sellCities, maxAge, minProfit, minRoi, sort]);

  const flip = (list: string[], c: string) => [...toggle(new Set(list), c)];
  if (loadErr) return <div className="wrap"><p className="err">{loadErr}</p></div>;

  return (
    <div className="wrap">
      <section className="card">
        <div className="card-h">
          <h2>{refine ? 'Refinado' : 'Crafteo'}</h2>
          <p className="muted">
            {refine
              ? 'Compara el costo de refinar (materia prima + material del tier anterior) con el precio de venta del recurso refinado.'
              : 'Compara el costo de los materiales con el precio de venta del ítem en ciudades o Mercado Negro.'}
            {' '}Incluye impuestos ({s.premium ? 'premium' : 'sin premium'}), retorno de recursos y tarifa de estación.
          </p>
        </div>

        <div className="grid">
          <div className="field">
            {!refine && <>
              <span className="lbl">Categorías</span>
              <div className="chips">
                {CRAFT_CATS.map((c) => <Chip key={c} on={cats.has(c)} onClick={() => setCats(toggle(cats, c))}>{CATEGORY_LABEL[c]}</Chip>)}
              </div>
            </>}
            <span className={'lbl' + (refine ? '' : ' sp')}>Tier</span>
            <div className="chips">{[2, 3, 4, 5, 6, 7, 8].map((t) => <Chip key={t} on={tiers.has(t)} onClick={() => setTiers(toggle(tiers, t))}>T{t}</Chip>)}</div>
            <span className="lbl sp">Encantamiento</span>
            <div className="chips">{[0, 1, 2, 3, 4].map((e) => <Chip key={e} on={ench.has(e)} onClick={() => setEnch(toggle(ench, e))}>.{e}</Chip>)}</div>
            <label className="inl sp">Buscar ítem
              <input type="search" placeholder="espada, tablas, T6_…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span className="lbl">Comprar materiales en</span>
            <div className="chips">
              {CITIES.filter((c) => c !== 'Black Market').map((c) => (
                <Chip key={c} on={matCities.includes(c)} onClick={() => setMatCities(flip(matCities, c))}>{cityName(c)}</Chip>
              ))}
            </div>
            <span className="lbl sp">Vender en</span>
            <div className="chips">
              {CITIES.filter((c) => !refine || c !== 'Black Market').map((c) => (
                <Chip key={c} on={sellCities.includes(c)} onClick={() => setSellCities(flip(sellCities, c))}>{cityName(c)}</Chip>
              ))}
            </div>
            <span className="muted small">Usa el ingrediente más barato y la mejor venta entre las ciudades marcadas.</span>
          </div>

          <div className="field">
            <label className="inl">Retorno de recursos
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {RRR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} — {pct(rrrFrom(p.bonus))}</option>)}
                <option value="custom">Personalizado (guarida, etc.)</option>
              </select>
            </label>
            {preset === 'custom' && (
              <div className="row">
                <label className="inl">Retorno %
                  <input className="w70" type="number" min={0} max={90} value={customRrr} onChange={(e) => setCustomRrr(Math.min(90, Math.max(0, +e.target.value || 0)))} />
                </label>
                <label className="inl chk"><input type="checkbox" checked={useCustomFocus} onChange={(e) => setUseCustomFocus(e.target.checked)} /> Uso foco</label>
              </div>
            )}
            <label className="inl">Tarifa de estación (plata / 100 de nutrición)
              <input className="w90" type="number" min={0} step={50} value={fee} onChange={(e) => setFee(Math.max(0, +e.target.value || 0))} />
            </label>
            <span className="muted small">Mírala en la estación de crafteo del juego. La tarifa total = valor del ítem × 0,1125 × tarifa / 100.</span>
            {refine && <span className="muted small">{REFINE_HINT}</span>}
          </div>
        </div>

        <div className="scanbar">
          <button className="btn primary" onClick={scan} disabled={!canScan}>
            {busy ? 'Escaneando…' : rows ? 'Actualizar precios' : 'Calcular rentabilidad'}
          </button>
          <label className="inl chk" title="Consulta la API directamente (gasta tu cupo de 100 peticiones/min)">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Consultar en vivo
          </label>
          {busy && <button className="btn ghost" onClick={() => { abort.current?.abort(); setBusy(false); }}>Cancelar</button>}
          <span className="muted">
            {fmt(outputs.length)} recetas · {fmt(allIds.length)} ítems{willBeLive ? ` · ${nReq} peticiones a la API` : ' · datos automáticos'}
            {tooMany && <b className="bad"> — demasiadas (máx. {MAX_REQUESTS}); reduce filtros</b>}
          </span>
          {busy && <progress value={prog[0]} max={Math.max(1, prog[1])} aria-label="Progreso" />}
        </div>
        {err && <p className="err">{err}</p>}
      </section>

      {rows && (
        <section className="card">
          <div className="resbar">
            <div>
              <h2>{fmt(opps.length)} {refine ? 'refinados rentables' : 'crafteos rentables'}</h2>
              <p className="muted small">
                {source === 'snapshot' ? 'Datos del servidor actualizados hace' : 'Consultado en vivo hace'} {ageText(Date.now() - scannedAt)} · retorno {pct(rrrInfo.rrr)}{rrrInfo.focus ? ' (con foco)' : ''} · cantidades por cada operación de crafteo
              </p>
            </div>
            <div className="row wrapr">
              <label className="inl">Dato máx.
                <select value={maxAge} onChange={(e) => setMaxAge(+e.target.value)}>
                  <option value={2}>2 h</option><option value={8}>8 h</option><option value={24}>24 h</option>
                  <option value={72}>3 días</option><option value={100000}>Sin límite</option>
                </select>
              </label>
              <label className="inl">Ganancia mín.
                <input className="w90" type="number" min={0} step={500} value={minProfit} onChange={(e) => setMinProfit(+e.target.value || 0)} />
              </label>
              <label className="inl">ROI mín. %
                <input className="w70" type="number" min={0} step={1} value={minRoi} onChange={(e) => setMinRoi(+e.target.value || 0)} />
              </label>
              <label className="inl">Ordenar
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="profit">Ganancia</option><option value="roi">ROI</option>
                  <option value="cost">Inversión (menor)</option>
                  {rrrInfo.focus && <option value="focus">Ganancia por foco</option>}
                </select>
              </label>
            </div>
          </div>

          {opps.length === 0 ? <p className="empty">Nada con esos filtros. Prueba bajar el ROI mínimo, ampliar la antigüedad o añadir ciudades/tiers.</p> : (
            <div className="tablewrap">
              <table>
                <thead><tr>
                  <th>Ítem</th><th className="r">Costo</th><th>Vender en</th><th className="r">Ingreso neto</th>
                  <th className="r">Ganancia</th><th className="r">ROI</th>
                  {rrrInfo.focus && <th className="r" title="Ganancia por cada 1.000 de foco gastado">Por 1k foco</th>}
                  <th>Confianza</th>
                </tr></thead>
                <tbody>
                  {opps.slice(0, limit).map((o) => (
                    <CraftRow key={o.id} o={o} names={names} showFocus={rrrInfo.focus} rrr={rrrInfo.rrr}
                      isOpen={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {opps.length > limit && <button className="btn ghost more" onClick={() => setLimit(limit + 100)}>Mostrar 100 más ({fmt(opps.length - limit)} restantes)</button>}
        </section>
      )}
    </div>
  );
}

function CraftRow({ o, names, showFocus, rrr, isOpen, onToggle }: {
  o: CraftOpp; names: Map<string, CatItem>; showFocus: boolean; rrr: number; isOpen: boolean; onToggle: () => void;
}) {
  const it = names.get(o.id);
  const worst = Math.max(o.buyAge, o.sellAge);
  return (
    <>
      <tr className={'row-main' + (isOpen ? ' open' : '')} onClick={onToggle} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <td>
          <div className="item">
            <ItemIcon id={o.id} />
            <div>
              <div className="nm">{it?.es ?? o.id}{o.recipe.out > 1 && <span className="mult"> ×{o.recipe.out}</span>}</div>
              <div className="sub">T{it?.t ?? '?'}{it?.e ? `.${it.e}` : ''}</div>
            </div>
          </div>
        </td>
        <td className="r num">{fmt(o.cost)}</td>
        <td>{cityName(o.sellCity)}</td>
        <td className="r num">{fmt(o.revenue)}</td>
        <td className={'r num ' + (o.profit >= 0 ? 'pos' : 'bad')}>{o.profit >= 0 ? '+' : ''}{fmt(o.profit)}</td>
        <td className="r num">{pct(o.roi)}</td>
        {showFocus && <td className="r num">{o.perFocus != null ? fmt(o.perFocus) : '—'}</td>}
        <td><Fresh level={o.level} ageMs={worst} suspect={o.suspect} /></td>
      </tr>
      {isOpen && (
        <tr className="detail"><td colSpan={showFocus ? 8 : 7}>
          <div className="detail-in">
            <table className="mini wide">
              <thead><tr><th>Ingrediente</th><th className="r">Cant.</th><th className="r">Efectiva</th><th className="r">Precio</th><th>Ciudad</th><th>Dato</th><th className="r">Subtotal</th></tr></thead>
              <tbody>
                {o.ings.map((g) => {
                  const eff = g.count * (g.returnable ? 1 - rrr : 1);
                  const n = names.get(g.id);
                  return (
                    <tr key={g.id}>
                      <td><span className="item sm"><ItemIcon id={g.id} size={28} />{n?.es ?? g.id}</span></td>
                      <td className="r num">{g.count}</td>
                      <td className="r num" title={g.returnable ? 'Tras el retorno de recursos' : 'No devuelve recursos'}>
                        {eff.toLocaleString('es', { maximumFractionDigits: 1 })}{!g.returnable && ' *'}
                      </td>
                      <td className="r num">{fmt(g.price)}</td>
                      <td>{cityName(g.city)}</td>
                      <td>{ageText(g.ageMs)}</td>
                      <td className="r num">{fmt(g.price * eff)}</td>
                    </tr>
                  );
                })}
                <tr className="tot"><td colSpan={6}>Materiales</td><td className="r num">{fmt(o.matCost)}</td></tr>
                <tr className="tot"><td colSpan={6}>Tarifa de estación</td><td className="r num">{fmt(o.fee)}</td></tr>
                {o.silver > 0 && <tr className="tot"><td colSpan={6}>Plata de la receta</td><td className="r num">{fmt(o.silver)}</td></tr>}
                <tr className="tot"><td colSpan={6}><b>Costo total</b></td><td className="r num"><b>{fmt(o.cost)}</b></td></tr>
                <tr className="tot"><td colSpan={6}>Venta {o.recipe.out > 1 ? `(${o.recipe.out} × ${fmt(o.sellNet)} neto)` : `(${fmt(o.sellGross)} bruto − impuestos)`} en {cityName(o.sellCity)} · dato de hace {ageText(o.sellAge)}</td><td className="r num">{fmt(o.revenue)}</td></tr>
              </tbody>
            </table>
            <span className="muted small">* Los artefactos y similares no devuelven recursos. Foco de la receta: {fmt(o.recipe.focus)} · {o.id}</span>
            <HistoryToggle id={o.id} quality={1} cities={[o.sellCity]} title="Historial del ítem terminado" />
          </div>
        </td></tr>
      )}
    </>
  );
}
