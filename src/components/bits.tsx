import { useState } from 'react';
import { iconUrl } from '../lib/api';
import { ageText } from '../lib/format';
import type { Level } from '../lib/market';

export function ItemIcon({ id, q = 1, size = 44 }: { id: string; q?: number; size?: number }) {
  const [bad, setBad] = useState(false);
  return bad ? <span className="icon ph" style={{ width: size, height: size }} /> : (
    <img className="icon" src={iconUrl(id, q, size >= 48 ? 128 : 64)} width={size} height={size}
      loading="lazy" alt="" onError={() => setBad(true)} />
  );
}

const LEVEL_TXT: Record<Level, string> = { fresh: 'Fresco', warn: 'Verificar', stale: 'Riesgoso' };

export function Fresh({ level, ageMs, suspect }: { level: Level; ageMs: number; suspect?: boolean }) {
  return (
    <span className={`fresh ${level}`} title={suspect ? 'ROI exagerado: probable dato erróneo' : 'Antigüedad del dato más viejo de la ruta'}>
      <i />{suspect ? '¿Error?' : LEVEL_TXT[level]} · {ageText(ageMs)}
    </span>
  );
}

export function toggle<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set);
  if (n.has(v)) n.delete(v); else n.add(v);
  return n;
}

export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button type="button" className={'chip' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on} title={title}>{children}</button>;
}
