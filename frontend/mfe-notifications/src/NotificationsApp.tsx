// MICROFRONTEND Notificaciones: avisos generados por Notification Service (consumer).
import { api, Badge, Panel, usePolling, type MfeProps, type Notification } from '@sentinel/shared';

export default function NotificationsApp(_props: MfeProps) {
  const { data, error, refresh } = usePolling(() => api<Notification[]>('/notifications'), 5000, ['sentinel:incidents-changed']);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read).length;

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'PATCH' }).catch(() => undefined);
    void refresh();
  }

  return (
    <Panel title="Notificaciones" extra={<>{unread > 0 && <span className="count">{unread}</span>}<span className="mfe-tag">mfe-notifications</span></>}>
      {error && <p className="error" role="alert">{error}</p>}
      {data && items.length === 0 && <p className="muted">Sin notificaciones. Llegan cuando un incidente es Alto o Crítico.</p>}
      <ul className="list">
        {items.map((n) => (
          <li key={n.id} className={n.read ? 'read' : ''}>
            <Badge value={n.severity} />
            <span>{n.message}</span>
            {!n.read && <button className="ghost small" onClick={() => void markRead(n.id)}>Leída</button>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
