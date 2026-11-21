import { lazy, useEffect, useState } from 'react';
import { on, usePolling, type User } from '@sentinel/shared';
import { initAuth, logout, relogin } from './auth';
import { RemoteSlot } from './RemoteSlot';

// Microfrontends cargados en tiempo de ejecución (Module Federation)
const IncidentsApp = lazy(() => import('incidents/IncidentsApp'));
const NotificationsApp = lazy(() => import('notifications/NotificationsApp'));
const AuditKpis = lazy(() => import('audit/AuditKpis'));
const AuditLog = lazy(() => import('audit/AuditLog'));

const ROLE: Record<User['role'], string> = { admin: 'Administrador', analyst: 'Analista', reporter: 'Reportante' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    initAuth()
      .then((u) => (u ? setUser(u) : setError('Tu usuario no tiene un rol de SentinelUNI (admin, analyst o reporter).')))
      .catch(() => setError('No se pudo conectar con el servidor de identidad (Keycloak). Revisa que el contenedor keycloak esté en "healthy".'));
    // Un 401 de la API borra la sesión: se vuelve a la pantalla de login de Keycloak.
    return on('sentinel:logout', relogin);
  }, []);

  if (error) return <AuthMessage text={error} />;
  if (!user) return <AuthMessage text="Conectando con Keycloak…" />;
  return <Dashboard user={user} onLogout={logout} />;
}

function AuthMessage({ text }: { text: string }) {
  return (
    <main className="login">
      <div className="panel login-box">
        <div className="brand"><span className="dot" />SentinelUNI</div>
        <p className="muted">Mini-SOC · gestión de incidentes de seguridad</p>
        <p role="status">{text}</p>
        <p className="hint">Inicio de sesión con Keycloak (OpenID Connect · JWT RS256)</p>
      </div>
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
