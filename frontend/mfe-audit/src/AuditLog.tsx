// MICROFRONTEND Auditoría (2/2): bitácora de eventos guardada por Audit Service (MongoDB).
import { api, Panel, time, usePolling, type AuditEntry, type MfeProps } from '@sentinel/shared';

export default function AuditLog(_props: MfeProps) {
  const { data, error } = usePolling(() => api<AuditEntry[]>('/audit'), 5000, ['sentinel:incidents-changed']);
  return (
    <Panel title="Bitácora de eventos" extra={<span className="mfe-tag">mfe-audit</span>}>
      {error && <p className="error" role="alert">{error}</p>}
      {data && data.length === 0 && <p className="muted">Aún no hay eventos.</p>}
      <ul className="list log">
        {(data ?? []).map((e) => (
          <li key={e.id}>
            <span className="mono muted">{time(e.timestamp)}</span>
            <span className="mono event">{e.type}</span>
            <span className="muted small">{e.source} · {e.incidentId}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
