import { lazy, useEffect, useState, type FormEvent } from 'react';
import { api, on, session, usePolling, type User } from '@sentinel/shared';
import { RemoteSlot } from './RemoteSlot';

// Microfrontends cargados en tiempo de ejecución (Module Federation)
const IncidentsApp = lazy(() => import('incidents/IncidentsApp'));
const NotificationsApp = lazy(() => import('notifications/NotificationsApp'));
const AuditKpis = lazy(() => import('audit/AuditKpis'));
const AuditLog = lazy(() => import('audit/AuditLog'));

const ROLE: Record<User['role'], string> = { admin: 'Administrador', analyst: 'Analista', reporter: 'Reportante' };

export default function App() {
  const [user, setUser] = useState<User | null>(() => (session.token() ? session.user() : null));
  useEffect(() => on('sentinel:logout', () => setUser(null)), []);
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => session.clear()} />;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('analista');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { token, user } = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
      session.save(token, user);
      onLogin(user);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="login">
      <form className="panel login-box" onSubmit={submit}>
        <div className="brand"><span className="dot" />SentinelUNI</div>
        <p className="muted">Mini-SOC · gestión de incidentes de seguridad</p>
        <label htmlFor="u">Usuario</label>
        <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <label htmlFor="p">Contraseña</label>
        <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">Ingresar</button>
        <p className="hint">Usuarios de prueba: analista / analista123 · admin / admin123 · usuario / usuario123</p>
      </form>
    </main>
  );
}

const SERVICES = ['users', 'incidents', 'triage', 'notifications', 'audit'];

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  // Estado de los servicios a través del API Gateway (rutas /api/health/* sin rate limit)
  const { data: health } = usePolling(async () => {
    const entries = await Promise.all(SERVICES.map(async (s) => {
      try { const r = await fetch(`/api/health/${s}`); return [s, r.ok] as const; } catch { return [s, false] as const; }
    }));
    return Object.fromEntries(entries) as Record<string, boolean>;
  }, 15000);

  const props = { user };
  const isSoc = user.role === 'analyst' || user.role === 'admin';
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="dot" />SentinelUNI</div>
        <div className="services" aria-label="Estado de los servicios">
          {SERVICES.map((s) => (
            <span key={s} className={`svc ${health?.[s] === false ? 'down' : health ? 'up' : ''}`}>{s}</span>
          ))}
        </div>
        <div className="who">
          {user.name} <span className="role">{ROLE[user.role]}</span>
          <button className="ghost" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {/* El reportante solo ve sus incidentes; indicadores, avisos y bitácora son del SOC */}
      {isSoc && <RemoteSlot name="Indicadores" Comp={AuditKpis} props={props} className="kpis-slot" />}
      <div className={isSoc ? 'grid' : 'grid single'}>
        <RemoteSlot name="Incidentes" Comp={IncidentsApp} props={props} className="main" />
        {isSoc && (
          <div className="side">
            <RemoteSlot name="Notificaciones" Comp={NotificationsApp} props={props} />
            <RemoteSlot name="Bitácora" Comp={AuditLog} props={props} />
          </div>
        )}
      </div>
    </div>
  );
}
