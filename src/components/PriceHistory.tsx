import { useEffect, useMemo, useState } from 'react';
import { fetchHistory, type HistoryRow } from '../lib/api';
import { cityName } from '../lib/catalog';
import { fmt } from '../lib/format';
import { useSettings } from '../lib/settings';

// Hasta 3 ciudades a la vez: las 3 primeras ranuras de la paleta categórica validan en todos los pares
// (daltonismo y visión normal) sobre la superficie oscura. El color sigue a la ciudad mientras esté seleccionada.
const MAX_SERIES = 3;
const SLOT = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const DAY = 86400000;

interface Pt { ts: number; avg: number; n: number }
const parse = (t: string) => Date.parse(t.endsWith('Z') ? t : t + 'Z');
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `${(n / 1e3).toLocaleString('es', { maximumFractionDigits: 1 })} k` : String(Math.round(n)));
const dateLbl = (ts: number) => new Date(ts).toLocaleDateString('es', { day: '2-digit', month: 'short', timeZone: 'UTC' });

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) { const v = min || 1; return [v * 0.9, v, v * 1.1]; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.01; v += step) out.push(v);
  return out;
}

interface Props { id: string; quality: number; cities: string[]; title?: string }

export default function PriceHistory({ id, quality, cities, title }: Props) {
  const { s } = useSettings();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  const [slots, setSlots] = useState<Record<string, number>>(() => Object.fromEntries(cities.slice(0, MAX_SERIES).map((c, i) => [c, i])));
  const [range, setRange] = useState(14);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setBusy(true); setErr('');
    fetchHistory(s.server, id, ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien', 'Black Market'], quality, ac.signal)
      .then((r) => { setRows(r); setBusy(false); })
      .catch((e) => { if ((e as Error).name !== 'AbortError') { setErr((e as Error).message); setBusy(false); } });
    return () => ac.abort();
  }, [id, quality, s.server]);

  // Serie por ciudad
  const byCity = useMemo(() => {
    const m = new Map<string, Pt[]>();
    for (const r of rows ?? []) {
      if (r.quality !== quality) continue;
      const pts = r.data.filter((d) => d.avg_price > 0).map((d) => ({ ts: parse(d.timestamp), avg: d.avg_price, n: d.item_count })).sort((a, b) => a.ts - b.ts);
      if (pts.length) m.set(r.location, pts);
    }
    return m;
  }, [rows, quality]);

  const sel = Object.keys(slots).filter((c) => byCity.has(c));
  const last = useMemo(() => Math.max(0, ...[...byCity.values()].map((p) => p[p.length - 1].ts)), [byCity]);
  const from = last - (range - 1) * DAY;
  const series = sel.map((c) => ({ city: c, slot: slots[c], pts: byCity.get(c)!.filter((p) => p.ts >= from) }));
  const days = [...new Set(series.flatMap((x) => x.pts.map((p) => p.ts)))].sort((a, b) => a - b);

  function toggleCity(c: string) {
    setSlots((o) => {
      if (c in o) { const { [c]: _, ...rest } = o; return rest; }
      const used = new Set(Object.values(o));
      if (used.size >= MAX_SERIES) return o;
      const free = [0, 1, 2].find((i) => !used.has(i))!;
      return { ...o, [c]: free };
    });
  }

  if (busy) return <p className="muted small">Cargando historial…</p>;
  if (err) return <p className="err small">No se pudo cargar el historial: {err}</p>;
  if (!byCity.size) return <p className="muted small">La API no tiene historial de ventas para este ítem.</p>;

  // Geometría
  const W = 720, H = 230, VH = 64, L = 52, R = 14, T = 12, B = 26;
  const t0 = days[0] ?? from, t1 = days[days.length - 1] ?? last;
  const vals = series.flatMap((x) => x.pts.map((p) => p.avg));
  const ticks = niceTicks(Math.min(...vals) * 0.97, Math.max(...vals) * 1.03);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (ts: number) => L + (t1 === t0 ? (W - L - R) / 2 : ((ts - t0) / (t1 - t0)) * (W - L - R));
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const path = (pts: Pt[]) => {
    let d = '';
    pts.forEach((p, i) => { d += `${i && p.ts - pts[i - 1].ts <= 2 * DAY ? 'L' : 'M'}${X(p.ts).toFixed(1)},${Y(p.avg).toFixed(1)}`; });
    return d;
  };
  const maxVol = Math.max(1, ...days.map((d) => series.reduce((a, x) => a + (x.pts.find((p) => p.ts === d)?.n ?? 0), 0)));
  const barW = Math.max(3, Math.min(26, ((W - L - R) / Math.max(1, days.length)) * 0.6));
  const xTicks = days.length <= 7 ? days : days.filter((_, i) => i % Math.ceil(days.length / 6) === 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - L - R) + L;
    let best = 0, bd = Infinity;
    days.forEach((d, i) => { const dd = Math.abs(X(d) - px); if (dd < bd) { bd = dd; best = i; } });
    setHover(best);
  };
  const hd = hover != null ? days[hover] : null;
  const tipLeft = hd != null ? (X(hd) / W) * 100 : 0;

  return (
    <div className="chart">
      <div className="chart-h">
        <b>{title ?? 'Historial de precios'}</b>
        <div className="chips">
          {[...byCity.keys()].map((c) => {
            const on = c in slots;
            return (
              <button key={c} type="button" className={'chip' + (on ? ' on' : '')} aria-pressed={on}
                disabled={!on && Object.keys(slots).length >= MAX_SERIES} onClick={() => toggleCity(c)}
                title={!on && Object.keys(slots).length >= MAX_SERIES ? `Máximo ${MAX_SERIES} ciudades a la vez` : ''}>
                {on && <i className="sw" style={{ background: SLOT[slots[c]] }} />}{cityName(c)}
              </button>
            );
          })}
        </div>
        <div className="seg" role="group" aria-label="Rango">
          {[7, 14, 30].map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r} d</button>)}
        </div>
        <button className="btn ghost" onClick={() => setTable((t) => !t)}>{table ? 'Ver gráfica' : 'Ver tabla'}</button>
      </div>

      {!series.length || !days.length ? <p className="muted small">Selecciona una ciudad con datos en este rango.</p> : table ? (
        <div className="tablewrap">
          <table className="mini">
            <thead><tr><th>Día</th>{series.map((x) => <th key={x.city} className="r">{cityName(x.city)} (precio · ventas)</th>)}</tr></thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d}><td>{dateLbl(d)}</td>{series.map((x) => { const p = x.pts.find((q) => q.ts === d); return <td key={x.city} className="r num">{p ? `${fmt(p.avg)} · ${fmt(p.n)}` : '—'}</td>; })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box" onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Precio promedio diario de ${series.map((x) => cityName(x.city)).join(', ')} en los últimos ${range} días`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
                <text className="axis" x={L - 8} y={Y(t) + 4} textAnchor="end">{short(t)}</text>
              </g>
            ))}
            {xTicks.map((d) => <text key={d} className="axis" x={X(d)} y={H - 6} textAnchor="middle">{dateLbl(d)}</text>)}
            {series.map((x) => (
              <g key={x.city}>
                <path d={path(x.pts)} fill="none" stroke={SLOT[x.slot]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {x.pts.length > 0 && <circle cx={X(x.pts[x.pts.length - 1].ts)} cy={Y(x.pts[x.pts.length - 1].avg)} r={4} fill={SLOT[x.slot]} className="ring" />}
              </g>
            ))}
            {hd != null && <line className="cross" x1={X(hd)} x2={X(hd)} y1={T} y2={H - B} />}
            {hd != null && series.map((x) => { const p = x.pts.find((q) => q.ts === hd); return p ? <circle key={x.city} cx={X(hd)} cy={Y(p.avg)} r={4.5} fill={SLOT[x.slot]} className="ring" /> : null; })}
            <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} />
          </svg>
          <svg viewBox={`0 0 ${W} ${VH}`} className="vol-svg" role="img" aria-label="Unidades vendidas por día (suma de las ciudades elegidas)">
            <text className="axis" x={L - 8} y={12} textAnchor="end">{short(maxVol)}</text>
            <text className="axis" x={L - 8} y={VH - 6} textAnchor="end">0</text>
            <line className="grid" x1={L} x2={W - R} y1={VH - 4} y2={VH - 4} />
            {days.map((d) => {
              const v = series.reduce((a, x) => a + (x.pts.find((p) => p.ts === d)?.n ?? 0), 0);
              const h = (v / maxVol) * (VH - 18);
              return <rect key={d} className={'bar' + (hd === d ? ' hi' : '')} x={X(d) - barW / 2} y={VH - 4 - h} width={barW} height={Math.max(h, v > 0 ? 2 : 0)} rx={2} />;
            })}
          </svg>
          <div className="axis-note muted small">Barras: unidades vendidas por día (suma de las ciudades elegidas)</div>
          {hd != null && (
            <div className="tip" style={{ left: `${Math.min(Math.max(tipLeft, 14), 80)}%` }}>
              <b>{dateLbl(hd)}</b>
              {series.map((x) => { const p = x.pts.find((q) => q.ts === hd); return (
                <div key={x.city}><i className="sw" style={{ background: SLOT[x.slot] }} />{cityName(x.city)}: {p ? <>{fmt(p.avg)} <span className="muted">· {fmt(p.n)} vend.</span></> : <span className="muted">sin datos</span>}</div>
              ); })}
            </div>
          )}
        </div>
      )}
      <span className="muted small">Promedio diario de ventas reales registradas por la comunidad (Albion Data). Los días sin ventas no tienen punto.</span>
    </div>
  );
}

/** Botón que muestra el historial solo cuando se pide (cada apertura consume 1 petición de la API). */
export function HistoryToggle(props: Props) {
  const [open, setOpen] = useState(false);
  return open ? <PriceHistory {...props} /> : (
    <button className="btn ghost" onClick={() => setOpen(true)}>Ver historial de precios</button>
  );
}
