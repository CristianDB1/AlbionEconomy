import { useState } from 'react';
import { SERVER_LABEL } from './lib/api';
import { taxRate, useSettings, type ServerKey } from './lib/settings';
import { pct } from './lib/format';
import Flipping from './pages/Flipping';
import Crafting from './pages/Crafting';

const TABS = [
  { id: 'flip', label: 'Flipping', ready: true },
  { id: 'craft', label: 'Crafteo', ready: true },
  { id: 'refine', label: 'Refinado', ready: true },
  { id: 'transmute', label: 'Transmutación', ready: false },
];

export default function App() {
  const { s, set } = useSettings();
  const [tab, setTab] = useState('flip');
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <span className="brand-mark" aria-hidden>◆</span>
            <span>Albion<b>Economy</b></span>
          </div>
          <nav className="tabs" aria-label="Módulos">
            {TABS.map((t) => (
              <button key={t.id} className={'tab' + (tab === t.id ? ' on' : '')} disabled={!t.ready}
                onClick={() => setTab(t.id)} title={t.ready ? '' : 'Próximamente'}>
                {t.label}{!t.ready && <small>pronto</small>}
              </button>
            ))}
          </nav>
          <div className="top-ctl">
            <div className="seg" role="group" aria-label="Estado premium">
              <button className={s.premium ? 'on' : ''} onClick={() => set({ premium: true })}>Premium</button>
              <button className={!s.premium ? 'on' : ''} onClick={() => set({ premium: false })}>Sin premium</button>
            </div>
            <span className="muted tax">Impuesto {pct(taxRate(s.premium))}</span>
            <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Ajustes</button>
          </div>
        </div>
        {open && (
          <div className="settings">
            <label>Servidor
              <select value={s.server} onChange={(e) => set({ server: e.target.value as ServerKey })}>
                {(Object.keys(SERVER_LABEL) as ServerKey[]).map((k) => <option key={k} value={k}>{SERVER_LABEL[k]}</option>)}
              </select>
            </label>
            <label>Compro…
              <select value={s.buyMode} onChange={(e) => set({ buyMode: e.target.value as 'instant' | 'order' })}>
                <option value="instant">al instante (orden de venta)</option>
                <option value="order">con orden de compra (+2,5 % tarifa)</option>
              </select>
            </label>
            <label>Vendo…
              <select value={s.sellMode} onChange={(e) => set({ sellMode: e.target.value as 'instant' | 'order' })}>
                <option value="instant">al instante (a orden de compra)</option>
                <option value="order">publicando orden de venta (+2,5 % tarifa)</option>
              </select>
            </label>
            <label>Dato fresco (verde) hasta
              <span className="num-in"><input type="number" min={0.5} step={0.5} value={s.freshHours}
                onChange={(e) => set({ freshHours: Math.max(0.1, +e.target.value || 2) })} /> h</span>
            </label>
            <label>Dato dudoso (amarillo) hasta
              <span className="num-in"><input type="number" min={1} step={1} value={s.staleHours}
                onChange={(e) => set({ staleHours: Math.max(s.freshHours, +e.target.value || 8) })} /> h</span>
            </label>
            <p className="muted small">Más allá del umbral amarillo el dato se marca en rojo (riesgoso). El Mercado Negro siempre vende al instante.</p>
          </div>
        )}
      </header>
      <main>
        {tab === 'flip' && <Flipping />}
        {tab === 'craft' && <Crafting key="craft" mode="craft" />}
        {tab === 'refine' && <Crafting key="refine" mode="refine" />}
      </main>
      <footer className="foot">
        Datos de la comunidad vía <a href="https://www.albion-online-data.com" target="_blank" rel="noreferrer">Albion Online Data Project</a> · imágenes © Sandbox Interactive · No afiliado a Albion Online.
      </footer>
    </>
  );
}
