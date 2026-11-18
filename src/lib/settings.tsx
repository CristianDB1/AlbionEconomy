import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ServerKey = 'west' | 'east' | 'europe';
export interface Settings {
  premium: boolean;
  server: ServerKey;
  buyMode: 'instant' | 'order';   // instant: compro de una orden de venta · order: pongo orden de compra
  sellMode: 'instant' | 'order';  // instant: vendo a una orden de compra · order: publico orden de venta
  freshHours: number;             // <= verde
  staleHours: number;             // <= amarillo, más = rojo
}

export const DEFAULTS: Settings = {
  premium: true, server: 'west', buyMode: 'instant', sellMode: 'instant', freshHours: 2, staleHours: 8,
};
const KEY = 'albioneconomy.settings.v1';

interface Ctx { s: Settings; set: (p: Partial<Settings>) => void }
const C = createContext<Ctx>({ s: DEFAULTS, set: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ } }, [s]);
  return <C.Provider value={{ s, set: (p) => setS((o) => ({ ...o, ...p })) }}>{children}</C.Provider>;
}
export const useSettings = () => useContext(C);

/** useState que recuerda su valor en localStorage (preferencias por navegador). */
export function usePersisted<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try { const r = localStorage.getItem('albioneconomy.' + key); return r == null ? init : (JSON.parse(r) as T); } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem('albioneconomy.' + key, JSON.stringify(v)); } catch { /* ignorar */ } }, [key, v]);
  return [v, setV] as const;
}

// Impuesto de mercado (venta): 4 % con premium, 8 % sin premium. Tarifa de publicación de órdenes: 2,5 %.
export const taxRate = (premium: boolean) => (premium ? 0.04 : 0.08);
export const SETUP_FEE = 0.025;
