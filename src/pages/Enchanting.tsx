import { useEffect, useMemo, useRef, useState } from 'react';
import { requestsFor, type PriceRow } from '../lib/api';
import { CATEGORY_LABEL, CITIES, cityName, loadCatalog, type CatItem } from '../lib/catalog';
import { loadRecipes, type Recipes } from '../lib/craft';
import { MAX_ITEM_LEVEL, computeEnchant, enchantIds, encId, type EnchKind, type EnchOpp } from '../lib/enchant';
import { ageText, fmt, pct } from '../lib/format';
import { usePersisted, useSettings } from '../lib/settings';
import { getPrices } from '../lib/store';
import { Chip, Fresh, ItemIcon, toggle } from '../components/bits';

const MAX_REQUESTS = 150;
const ITEM_CATS = ['weapons', 'armors', 'head', 'shoes', 'capes', 'offhands', 'bags'];
const UPGRADE_NAME = ['', 'Runas', 'Almas', 'Reliquias'];
type SortKey = 'profit' | 'roi' | 'cost';

export default function Enchanting() {
  const { s } = useSettings();
  const [kind, setKind] = useState<EnchKind>('item');
  const [catalog, setCatalog] = useState<CatItem[]>([]);
  const [recipes, setRecipes] = useState<Recipes>({});
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => {
    Promise.all([loadCatalog(), loadRecipes()]).then(([c, r]) => { setCatalog(c); setRecipes(r); })
      .catch((e) => setLoadErr(String(e.message || e)));
  }, []);

  const [cats, setCats] = useState(new Set(ITEM_CATS));
  const [tiers, setTiers] = useState(new Set([4, 5, 6, 7, 8]));
  const [query, setQuery] = useState('');
  const [buyCities, setBuyCities] = usePersisted<string[]>('ench.buy', CITIES.filter((c) => c !== 'Black Market'));
  const [sellCities, setSellCities] = usePersisted<string[]>('ench.sell', CITIES);

  const [maxAge, setMaxAge] = useState(24);
  const [minProfit, setMinProfit] = useState(0);
  const [minRoi, setMinRoi] = useState(3);
  const [sort, setSort] = useState<SortKey>('profit');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);

  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [scanBases, setScanBases] = useState<string[]>([]);
  const [scanKind, setScanKind] = useState<EnchKind>('item');
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  const [err, setErr] = useState('');
  const [scannedAt, setScannedAt] = useState(0);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<'snapshot' | 'live'>('snapshot');
  const abort = useRef<AbortController | null>(null);

  const bases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((i) => {
      if (i.e !== 0 || !tiers.has(i.t)) return false;
      if (kind === 'item' ? !(cats.has(i.c) && recipes[`${i.id}@1`]?.[0]?.up) : !(i.c === 'crafting' && i.s === 'resources' && recipes[`${i.id}_LEVEL1@1`])) return false;
      return !q || i.es.toLowerCase().includes(q) || i.en.toLowerCase().includes(q) || i.id.toLowerCase().includes(q);
    });
  }, [catalog, recipes, kind, cats, tiers, query]);

  const names = useMemo(() => new Map(catalog.map((i) => [i.id, i])), [catalog]);
  const allIds = useMemo(() => enchantIds(bases.map((b) => b.id), recipes, kind), [bases, recipes, kind]);
  const nReq = requestsFor(allIds.length);
  const willBeLive = live || s.server !== 'west';
  const tooMany = willBeLive && nReq > MAX_REQUESTS;
  const canScan = !busy && bases.length > 0 && !tooMany && buyCities.length > 0 && sellCities.length > 0;

  async function scan() {
    if (!canScan) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy(true); setErr(''); setProg([0, nReq]); setOpen(null); setLimit(100);
    const ids = bases.map((b) => b.id);
    try {
      const cities = [...new Set([...buyCities, ...sellCities])];
      const res = await getPrices({
        server: s.server, ids: allIds, cities, qualities: [1], live, catalog,
        onProgress: (d, t) => setProg([d, t]), signal: ac.signal,
      });
      setRows(res.rows); setScanBases(ids); setScanKind(kind); setScannedAt(res.updatedAt); setSource(res.source);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(`No se pudo consultar la API: ${(e as Error).message}`);
    } finally { if (abort.current === ac) setBusy(false); }
  }

  const opps = useMemo(() => {
    if (!rows) return [];
    const list = computeEnchant(scanBases, recipes, rows, s, { buyCities, sellCities, maxAgeHours: maxAge, kind: scanKind })
      .filter((o) => o.profit >= minProfit && o.roi * 100 >= minRoi);
    const key: Record<SortKey, (o: EnchOpp) => number> = { profit: (o) => -o.profit, roi: (o) => -o.roi, cost: (o) => o.cost };
    return list.sort((a, b) => key[sort](a) - key[sort](b));
  }, [rows, scanBases, scanKind, recipes, s, buyCities, sellCities, maxAge, minProfit, minRoi, sort]);

  const flip = (list: string[], c: string) => [...toggle(new Set(list), c)];
  if (loadErr) return <div className="wrap"><p className="err">{loadErr}</p></div>;

  return (
    <div className="wrap">
      <section className="card">
        <div className="card-h">
          <h2>Transmutación y encantamiento</h2>
          <div className="seg modeseg" role="group" aria-label="Tipo">
            <button className={kind === 'item' ? 'on' : ''} onClick={() => { setKind('item'); setRows(null); }}>Ítems (runas, almas, reliquias)</button>
            <button className={kind === 'res' ? 'on' : ''} onClick={() => { setKind('res'); setRows(null); }}>Recursos (plata)</button>
          </div>
          <p className="muted">
            {kind === 'item'
              ? 'Compra un ítem sin encantar o con poco encantamiento, súbelo con runas (.1), almas (.2) y reliquias (.3) del mismo tier, y véndelo más caro. Usa las cantidades reales de cada ítem. El paso a .4 (fragmentos avalonianos) no está incluido porque no tengo su cantidad verificada.'
              : 'Sube madera, mineral, fibra, cuero o piedra de .0 a .4 pagando solo plata por paso (la transmutación consume 1 unidad del nivel anterior) y vende el recurso encantado.'}
            {' '}Incluye impuestos ({s.premium ? 'premium' : 'sin premium'}) y el semáforo de frescura.
          </p>
        </div>

        <div className="grid">
          <div className="field">
            {kind === 'item' && <>
              <span className="lbl">Categorías</span>
              <div className="chips">
                {ITEM_CATS.map((c) => <Chip key={c} on={cats.has(c)} onClick={() => setCats(toggle(cats, c))}>{CATEGORY_LABEL[c]}</Chip>)}
              </div>
            </>}
            <span className={'lbl' + (kind === 'item' ? ' sp' : '')}>Tier</span>
            <div className="chips">{[4, 5, 6, 7, 8].map((t) => <Chip key={t} on={tiers.has(t)} onClick={() => setTiers(toggle(tiers, t))}>T{t}</Chip>)}</div>
            <label className="inl sp">Buscar
              <input type="search" placeholder="espada, madera, T6_…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div className="field">
            <span className="lbl">Comprar ítem y materiales en</span>
            <div className="chips">
              {CITIES.filter((c) => c !== 'Black Market').map((c) => (
                <Chip key={c} on={buyCities.includes(c)} onClick={() => setBuyCities(flip(buyCities, c))}>{cityName(c)}</Chip>
              ))}
            </div>
            <span className="lbl sp">Vender en</span>
            <div className="chips">
              {CITIES.map((c) => <Chip key={c} on={sellCities.includes(c)} onClick={() => setSellCities(flip(sellCities, c))}>{cityName(c)}</Chip>)}
            </div>
          </div>
          <div className="field">
            <span className="muted small">
              Se evalúan todas las rutas posibles (por ejemplo .0→.1, .0→.3, .1→.3…) y se muestra la más rentable de cada ítem.
              Las demás aparecen al abrir la fila. El encantamiento se hace en la mesa de encantamiento del juego; aquí no se suma tarifa de estación.
            </span>
            <span className="muted small">Los precios de ítems encantados se refrescan en el servidor cada ~30 min.</span>
          </div>
        </div>

        <div className="scanbar">
          <button className="btn primary" onClick={scan} disabled={!canScan}>
            {busy ? 'Escaneando…' : rows ? 'Actualizar precios' : 'Buscar oportunidades'}
          </button>
          <label className="inl chk" title="Consulta la API directamente (gasta tu cupo de 100 peticiones/min)">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Consultar en vivo
          </label>
          {busy && <button className="btn ghost" onClick={() => { abort.current?.abort(); setBusy(false); }}>Cancelar</button>}
          <span className="muted">
            {fmt(bases.length)} {kind === 'item' ? 'ítems' : 'recursos'} · {fmt(allIds.length)} precios{willBeLive ? ` · ${nReq} peticiones a la API` : ' · datos automáticos'}
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
              <h2>{fmt(opps.length)} oportunidades</h2>
              <p className="muted small">
                {source === 'snapshot' ? 'Datos del servidor actualizados hace' : 'Consultado en vivo hace'} {ageText(Date.now() - scannedAt)} · una unidad por operación
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
                  <option value="profit">Ganancia</option><option value="roi">ROI</option><option value="cost">Inversión (menor)</option>
                </select>
              </label>
            </div>
          </div>

          {opps.length === 0 ? <p className="empty">Nada con esos filtros. Prueba bajar el ROI mínimo, ampliar la antigüedad o añadir ciudades y tiers.</p> : (
            <div className="tablewrap">
              <table>
                <thead><tr>
                  <th>{scanKind === 'item' ? 'Ítem' : 'Recurso'}</th><th>Subida</th><th className="r">Costo total</th>
                  <th>Vender en</th><th className="r">Ingreso neto</th><th className="r">Ganancia</th><th className="r">ROI</th><th>Confianza</th>
                </tr></thead>
                <tbody>
                  {opps.slice(0, limit).map((o) => (
                    <EnchRow key={o.base} o={o} names={names} isOpen={open === o.base} onToggle={() => setOpen(open === o.base ? null : o.base)} />
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

function EnchRow({ o, names, isOpen, onToggle }: { o: EnchOpp; names: Map<string, CatItem>; isOpen: boolean; onToggle: () => void }) {
  const it = names.get(o.base);
  const worst = Math.max(o.srcAge, o.sellAge, ...o.steps.map((x) => x.ageMs));
  return (
    <>
      <tr className={'row-main' + (isOpen ? ' open' : '')} onClick={onToggle} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <td>
          <div className="item">
            <ItemIcon id={o.dstId} />
            <div><div className="nm">{it?.es ?? o.base}</div><div className="sub">T{it?.t ?? '?'}</div></div>
          </div>
        </td>
        <td><span className="route">.{o.from} <i>→</i> .{o.to}</span></td>
        <td className="r num">{fmt(o.cost)}</td>
        <td>{cityName(o.sellCity)}</td>
        <td className="r num">{fmt(o.sellNet)}</td>
        <td className={'r num ' + (o.profit >= 0 ? 'pos' : 'bad')}>{o.profit >= 0 ? '+' : ''}{fmt(o.profit)}</td>
        <td className="r num">{pct(o.roi)}</td>
        <td><Fresh level={o.level} ageMs={worst} suspect={o.suspect} /></td>
      </tr>
      {isOpen && (
        <tr className="detail"><td colSpan={8}>
          <div className="detail-in">
            <table className="mini wide">
              <thead><tr><th>Concepto</th><th className="r">Cant.</th><th className="r">Precio</th><th>Ciudad</th><th>Dato</th><th className="r">Subtotal</th></tr></thead>
              <tbody>
                <tr>
                  <td><span className="item sm"><ItemIcon id={o.srcId} size={28} />{it?.es ?? o.base} .{o.from} (comprar)</span></td>
                  <td className="r num">1</td><td className="r num">{fmt(o.srcPrice)}</td><td>{cityName(o.srcCity)}</td><td>{ageText(o.srcAge)}</td>
                  <td className="r num">{fmt(o.srcPrice)}</td>
                </tr>
                {o.steps.map((st) => {
                  const n = names.get(st.id);
                  return st.id ? (
                    <tr key={st.to}>
                      <td><span className="item sm"><ItemIcon id={st.id} size={28} />{n?.es ?? st.id} → .{st.to} ({UPGRADE_NAME[st.to] ?? ''})</span></td>
                      <td className="r num">{fmt(st.count)}</td><td className="r num">{fmt(st.price)}</td><td>{cityName(st.city)}</td><td>{ageText(st.ageMs)}</td>
                      <td className="r num">{fmt(st.price * st.count)}</td>
                    </tr>
                  ) : (
                    <tr key={st.to}><td>Transmutación a .{st.to} (plata)</td><td /><td /><td /><td /><td className="r num">{fmt(st.silver)}</td></tr>
                  );
                })}
                <tr className="tot"><td colSpan={5}><b>Costo total</b></td><td className="r num"><b>{fmt(o.cost)}</b></td></tr>
                <tr className="tot"><td colSpan={5}>Venta de .{o.to} en {cityName(o.sellCity)} ({fmt(o.sellGross)} bruto − impuestos) · dato de hace {ageText(o.sellAge)}</td><td className="r num">{fmt(o.sellNet)}</td></tr>
              </tbody>
            </table>
            {o.alts.length > 1 && (
              <div className="vol">
                <b>Otras rutas</b>
                {o.alts.slice(1).map((a) => (
                  <span key={`${a.from}-${a.to}`}>.{a.from}→.{a.to}: {a.profit >= 0 ? '+' : ''}{fmt(a.profit)} ({pct(a.roi)})</span>
                ))}
              </div>
            )}
            <span className="muted small">{o.base} · ruta calculada hasta .{o.kind === 'item' ? MAX_ITEM_LEVEL : 4} · {encId(o.base, o.to, o.kind)}</span>
          </div>
        </td></tr>
      )}
    </>
  );
}
