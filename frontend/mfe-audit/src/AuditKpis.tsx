// MICROFRONTEND Auditoría (1/2): indicadores calculados por Audit Service (Redis).
import { api, usePolling, type AuditStats, type MfeProps } from '@sentinel/shared';

export default function AuditKpis(_props: MfeProps) {
  const { data } = usePolling(() => api<AuditStats>('/audit/stats'), 5000, ['sentinel:incidents-changed']);
  const s = data;
  return (
    <section className="kpis" aria-label="Indicadores">
      <Kpi label="Incidentes reportados" value={s?.byType.IncidentCreated ?? 0} />
      <Kpi label="Críticos" value={s?.bySeverity['Crítica'] ?? 0} tone="sev-crit" />
      <Kpi label="Altos" value={s?.bySeverity.Alta ?? 0} tone="sev-high" />
      <Kpi label="Cambios de estado" value={s?.byType.IncidentStatusChanged ?? 0} />
      <Kpi label="Eventos en el bus" value={s?.totalEvents ?? 0} />
    </section>
  );
}

function Kpi({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return <div className={`kpi panel ${tone}`}><span className="kpi-value">{value}</span><span className="kpi-label">{label}</span></div>;
}
