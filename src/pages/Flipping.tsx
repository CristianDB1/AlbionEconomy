import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchHistory, parseDate, requestsFor, type HistoryRow, type PriceRow } from '../lib/api';
import { getPrices } from '../lib/store';
import {
  CATEGORY_LABEL, CATEGORY_ORDER, CITIES, QUALITY_LABEL, cityName, loadCatalog, type CatItem,
} from '../lib/catalog';
import { ageText, fmt, pct } from '../lib/format';
import { computeOpps, levelOf, type Opp } from '../lib/market';
import { useSettings } from '../lib/settings';
import { Chip, Fresh, ItemIcon, toggle } from '../components/bits';
import { HistoryToggle } from '../components/PriceHistory';

const MAX_REQUESTS = 150;
const DEFAULT_CATS = ['weapons', 'armors', 'head', 'shoes', 'capes', 'offhands', 'bags', 'mounts', 'consumables', 'crafting', 'artefacts'];
type SortKey = 'profit' | 'roi' | 'cost' | 'age';

export default function Flipping() {
  const { s } = useSettings();
  const [catalog, setCatalog] = useState<CatItem[]>([]);
  const [loadErr, setLoadErr] = useState('');
  useEffect(() => { loadCatalog().then(setCatalog).catch((e) => setLoadErr(String(e.message || e))); }, []);

  // Filtros de escaneo
  const [cats, setCats] = useState(new Set(DEFAULT_CATS));
  const [tiers, setTiers] = useState(new Set([4, 5, 6, 7, 8]));
  const [ench, setEnch] = useState(new Set([0]));
  const [cities, setCities] = useState(new Set(CITIES));
  const [quality, setQuality] = useState(1);
  const [query, setQuery] = useState('');

  // Filtros de resultado (sin volver a pedir datos)
  const [maxAge, setMaxAge] = useState(24);
  const [minProfit, setMinProfit] = useState(1000);
  const [minRoi, setMinRoi] = useState(5);
  const [sort, setSort] = useState<SortKey>('profit');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState<string | null>(null);

  // Estado de escaneo
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  const [err, setErr] = useState('');
  const [scannedAt, setScannedAt] = useState(0);
  const [live, setLive] = useState(false);
  const [source, setSource] = useState<'snapshot' | 'live'>('snapshot');
  const abort = useRef<AbortController | null>(null);

  const selected = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((i) => cats.has(i.c) && tiers.has(i.t) && ench.has(i.e) &&
      (!q || i.es.toLowerCase().includes(q) || i.en.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)));
  }, [catalog, cats, tiers, ench, query]);
  const names = useMemo(() => new Map(catalog.map((i) => [i.id, i])), [catalog]);
  const nReq = requestsFor(selected.length);
  const willBeLive = live || quality !== 1 || s.server !== 'west';
  const tooMany = willBeLive && nReq > MAX_REQUESTS;

  async function scan() {
    if (!selected.length || tooMany || cities.size < 2) return;
    abort.current?.abort();
    const ac = (abort.current = new AbortController());
    setBusy(true); setErr(''); setProg([0, nReq]); setOpen(null); setLimit(100);
    try {
      const qs = quality === 0 ? [1, 2, 3, 4, 5] : [quality];
      const res = await getPrices({
        server: s.server, ids: selected.map((i) => i.id), cities: [...cities], qualities: qs, live, catalog,
        onProgress: (d, t) => setProg([d, t]), signal: ac.signal,
      });
      setRows(res.rows); setScannedAt(res.updatedAt); setSource(res.source);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr(`No se pudo consultar la API: ${(e as Error).message}`);
    } finally { if (abort.current === ac) setBusy(false); }
  }

  const opps = useMemo(() => {
    if (!rows) return [];
    const list = computeOpps(rows, s, { maxAgeHours: maxAge, cities: [...cities] })
      .filter((o) => o.profit >= minProfit && o.roi * 100 >= minRoi);
    const key: Record<SortKey, (o: Opp) => number> = {
      profit: (o) => -o.profit, roi: (o) => -o.roi, cost: (o) => o.cost, age: (o) => Math.max(o.buyAge, o.sellAge),
    };
    return list.sort((a, b) => key[sort](a) - key[sort](b));
  }, [rows, s, maxAge, cities, minProfit, minRoi, sort]);

  if (loadErr) return <div className="wrap"><p className="err">{loadErr}</p></div>;

  return (
    <div className="wrap">
      <section className="card">
        <div className="card-h">
          <h2>Flipping entre ciudades</h2>
          <p className="muted">Compra en una ciudad y vende más caro en otra o en el Mercado Negro. Los cálculos ya incluyen impuestos
            ({s.premium ? 'premium' : 'sin premium'}) y cambian al instante si alternas premium.</p>
        </div>

        <div className="grid">
          <div className="field">
            <span className="lbl">Categorías</span>
            <div className="chips">
              {CATEGORY_ORDER.map((c) => <Chip key={c} on={cats.has(c)} onClick={() => setCats(toggle(cats, c))}>{CATEGORY_LABEL[c]}</Chip>)}
            </div>
          </div>
          <div className="field">
            <span className="lbl">Tier</span>
            <div className="chips">{[1, 2, 3, 4, 5, 6, 7, 8].map((t) => <Chip key={t} on={tiers.has(t)} onClick={() => setTiers(toggle(tiers, t))}>T{t}</Chip>)}</div>
            <span className="lbl sp">Encantamiento</span>
            <div className="chips">{[0, 1, 2, 3, 4].map((e) => <Chip key={e} on={ench.has(e)} onClick={() => setEnch(toggle(ench, e))}>.{e}</Chip>)}</div>
          </div>
          <div className="field">
            <span className="lbl">Ciudades (mín. 2)</span>
            <div className="chips">{CITIES.map((c) => <Chip key={c} on={cities.has(c)} onClick={() => setCities(toggle(cities, c))}>{cityName(c)}</Chip>)}</div>
            <div className="row sp">
              <label className="inl">Calidad
                <select value={quality} onChange={(e) => setQuality(+e.target.value)}>
                  {[1, 2, 3, 4, 5].map((q) => <option key={q} value={q}>{QUALITY_LABEL[q]}</option>)}
                  <option value={0}>Todas</option>
                </select>
              </label>
              <label className="inl grow">Buscar ítem
                <input type="search" placeholder="espada, bolsa, T6_…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div className="scanbar">
          <button className="btn primary" onClick={scan} disabled={busy || !selected.length || tooMany || cities.size < 2}>
            {busy ? 'Escaneando…' : rows ? 'Actualizar precios' : 'Buscar oportunidades'}
          </button>
          <label className="inl chk" title="Consulta la API directamente (gasta tu cupo de 100 peticiones/min)">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Consultar en vivo
          </label>
          {busy && <button className="btn ghost" onClick={() => { abort.current?.abort(); setBusy(false); }}>Cancelar</button>}
          <span className="muted">
            {fmt(selected.length)} ítems{willBeLive ? ` · ${nReq} peticiones a la API` : ' · datos automáticos'}
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
              <p className="muted small">{source === 'snapshot' ? 'Datos del servidor actualizados hace' : 'Consultado en vivo hace'} {ageText(Date.now() - scannedAt)} · mostrando la mejor ruta por ítem</p>
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
                  <option value="cost">Inversión (menor)</option><option value="age">Más fresco</option>
                </select>
              </label>
            </div>
          </div>

          {opps.length === 0 ? <p className="empty">Nada con esos filtros. Prueba bajar la ganancia mínima, ampliar la antigüedad o añadir tiers y ciudades.</p> : (
            <div className="tablewrap">
              <table>
                <thead><tr>
                  <th>Ítem</th><th>Ruta</th><th className="r">Compra</th><th className="r">Venta (neta)</th>
                  <th className="r">Ganancia</th><th className="r">ROI</th><th>Confianza</th>
                </tr></thead>
                <tbody>
                  {opps.slice(0, limit).map((o) => {
                    const k = `${o.id}|${o.q}`;
                    const it = names.get(o.id);
                    return (
                      <FlipRow key={k} o={o} name={it?.es ?? o.id} tier={it?.t ?? 0} ench={it?.e ?? 0}
                        isOpen={open === k} onToggle={() => setOpen(open === k ? null : k)} />
                    );
                  })}
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

function FlipRow({ o, name, tier, ench, isOpen, onToggle }: {
  o: Opp; name: string; tier: number; ench: number; isOpen: boolean; onToggle: () => void;
}) {
  const worst = Math.max(o.buyAge, o.sellAge);
  return (
    <>
      <tr className={'row-main' + (isOpen ? ' open' : '')} onClick={onToggle} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <td>
          <div className="item">
            <ItemIcon id={o.id} q={o.q} />
            <div>
              <div className="nm">{name}</div>
              <div className="sub">T{tier}{ench ? `.${ench}` : ''}{o.q > 1 ? ` · ${QUALITY_LABEL[o.q]}` : ''}</div>
            </div>
          </div>
        </td>
        <td><span className="route">{cityName(o.from)} <i>→</i> {cityName(o.to)}</span></td>
        <td className="r num">{fmt(o.cost)}</td>
        <td className="r num">{fmt(o.sellNet)}</td>
        <td className="r num pos">+{fmt(o.profit)}</td>
        <td className="r num">{pct(o.roi)}</td>
        <td><Fresh level={o.level} ageMs={worst} suspect={o.suspect} /></td>
      </tr>
      {isOpen && <tr className="detail"><td colSpan={7}><Detail o={o} /></td></tr>}
    </>
  );
}

function Detail({ o }: { o: Opp }) {
  const { s } = useSettings();
  const [vol, setVol] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const now = Date.now();

  async function loadVol() {
    setBusy(true); setErr('');
    try {
      const h: HistoryRow[] = await fetchHistory(s.server, o.id, [o.from, o.to], o.q);
      const res: Record<string, number> = {};
      for (const r of h) {
        const last = r.data.slice(-7);
        res[r.location] = last.length ? last.reduce((a, d) => a + d.item_count, 0) / 7 : 0;
      }
      setVol(res);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const list = [...o.prices.values()].sort((a, b) => a.city.localeCompare(b.city));
  return (
    <div className="detail-in">
      <table className="mini">
        <thead><tr><th>Ciudad</th><th className="r">Venta mín.</th><th>Dato</th><th className="r">Compra máx.</th><th>Dato</th></tr></thead>
        <tbody>
          {list.map((r) => {
            const sd = parseDate(r.sell_price_min_date), bd = parseDate(r.buy_price_max_date);
            const cls = r.city === o.from ? 'from' : r.city === o.to ? 'to' : '';
            return (
              <tr key={r.city} className={cls}>
                <td>{cityName(r.city)}{cls === 'from' && <em> compra aquí</em>}{cls === 'to' && <em> vende aquí</em>}</td>
                <td className="r num">{r.sell_price_min > 0 ? fmt(r.sell_price_min) : '—'}</td>
                <td className={sd ? levelOf(now - sd, s) : ''}>{sd ? ageText(now - sd) : '—'}</td>
                <td className="r num">{r.buy_price_max > 0 ? fmt(r.buy_price_max) : '—'}</td>
                <td className={bd ? levelOf(now - bd, s) : ''}>{bd ? ageText(now - bd) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="vol">
        {vol ? (
          <>
            <b>Ventas diarias (prom. 7 días)</b>
            {[o.from, o.to].map((c) => <span key={c}>{cityName(c)}: {vol[c] != null ? fmt(vol[c]) : 'sin datos'}</span>)}
            <span className="muted small">Si el volumen es bajo, tu venta puede tardar o el precio ser engañoso.</span>
          </>
        ) : (
          <button className="btn ghost" onClick={loadVol} disabled={busy}>{busy ? 'Consultando…' : 'Ver volumen de ventas'}</button>
        )}
        {err && <span className="err">{err}</span>}
        <span className="muted small id">{o.id}</span>
      </div>
      <HistoryToggle id={o.id} quality={o.q} cities={[o.from, o.to]} />
    </div>
  );
}
