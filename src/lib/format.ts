export const fmt = (n: number) => Math.round(n).toLocaleString('es');
export const pct = (n: number) => `${(n * 100).toLocaleString('es', { maximumFractionDigits: 1 })} %`;
export function ageText(ms: number | null): string {
  if (ms == null) return '—';
  const m = Math.max(0, ms) / 60000;
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 48) return `${h.toLocaleString('es', { maximumFractionDigits: 1 })} h`;
  return `${Math.round(h / 24)} d`;
}
