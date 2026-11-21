// Modo independiente (desarrollo): el microfrontend se puede abrir solo en su puerto.
import { createRoot } from 'react-dom/client';
import { session } from '@sentinel/shared';
import AuditKpis from './AuditKpis';
import AuditLog from './AuditLog';
import '../../shell/src/styles.css';

const user = session.user();
createRoot(document.getElementById('root')!).render(
  user ? <><AuditKpis user={user} /><br /><AuditLog user={user} /></> : <p className="muted">Inicia sesión desde el shell (http://localhost:4000) para usar este microfrontend.</p>,
);
