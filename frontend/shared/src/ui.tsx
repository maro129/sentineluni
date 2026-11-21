import type { ReactNode } from 'react';

export const sevClass = (s: string) =>
  ({ Baja: 'sev-low', Media: 'sev-med', Alta: 'sev-high', 'Crítica': 'sev-crit', Info: 'sev-info' } as Record<string, string>)[s] ?? 'sev-pending';

export const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function Badge({ value }: { value: string }) {
  return <span className={`badge ${sevClass(value)}`}>{value}</span>;
}

export function Panel({ title, extra, children, className = '' }: { title: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <h2>{title} {extra}</h2>
      {children}
    </section>
  );
}
