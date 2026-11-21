// MICROFRONTEND Incidentes: reporte (con evidencia) y gestión del ciclo de vida.
// Consume solo Incident Service a través del API Gateway.
import { useState, type FormEvent } from 'react';
import {
  api, Badge, download, emit, INCIDENT_TYPES, NEXT_STATUS, Panel, time, usePolling,
  type Incident, type MfeProps, type Status,
} from '@sentinel/shared';

export default function IncidentsApp({ user }: MfeProps) {
  const { data, error, refresh } = usePolling(() => api<Incident[]>('/incidents'), 3000, ['sentinel:incidents-changed']);
  const canManage = user.role === 'analyst' || user.role === 'admin';
  const [actionError, setActionError] = useState('');

  async function changeStatus(id: string, status: Status) {
    setActionError('');
    try {
      await api(`/incidents/${id}/status`, { method: 'PATCH', body: { status } });
      emit('sentinel:incidents-changed');
    } catch (e) {
      setActionError((e as Error).message);
      void refresh();
    }
  }

  const incidents = data ?? [];
  return (
    <div className="incidents-layout">
      <ReportForm onCreated={() => emit('sentinel:incidents-changed')} />
      <Panel title={user.role === 'reporter' ? 'Mis incidentes' : 'Incidentes'} extra={<span className="mfe-tag">mfe-incidents</span>}>
        {(error || actionError) && <p className="error" role="alert">{actionError || error}</p>}
        {data && incidents.length === 0 && <p className="muted">Aún no hay incidentes. Reporta uno con el formulario.</p>}
        {incidents.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Incidente</th><th>Severidad</th><th>Estado</th><th>Reportado</th></tr></thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.id}</td>
                    <td>
                      <strong>{i.title}</strong>
                      <div className="muted small">{INCIDENT_TYPES.find(([k]) => k === i.type)?.[1]}{i.asset && ` · ${i.asset}`}</div>
                      {i.triageReasons.length > 0 && <div className="reasons">{i.triageReasons.join(' · ')}</div>}
                      {i.evidenceName && (
                        <button className="link" onClick={() => void download(`/incidents/${i.id}/evidence`, i.evidenceName!)}>📎 {i.evidenceName}</button>
                      )}
                    </td>
                    <td><Badge value={i.severity} /></td>
                    <td>
                      {canManage && NEXT_STATUS[i.status].length > 0 ? (
                        <select aria-label={`Estado de ${i.id}`} value={i.status} onChange={(e) => void changeStatus(i.id, e.target.value as Status)}>
                          {[i.status, ...NEXT_STATUS[i.status]].map((s) => <option key={s}>{s}</option>)}
                        </select>
                      ) : <span className="small">{i.status}</span>}
                    </td>
                    <td className="small">{i.reportedBy}<div className="muted">{time(i.createdAt)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ReportForm({ onCreated }: { onCreated: () => void }) {
  const empty = { title: '', type: 'phishing', description: '', asset: '' };
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let inc: Incident;
      if (file) {
        // multipart/form-data: la evidencia va a Object Storage (MinIO)
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        fd.append('evidence', file);
        inc = await api<Incident>('/incidents', { method: 'POST', form: fd });
      } else {
        inc = await api<Incident>('/incidents', { method: 'POST', body: form });
      }
      setMsg(`Registrado ${inc.id}. Clasificándolo…`);
      setForm(empty); setFile(null); setFileKey((k) => k + 1);
      onCreated();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel report" onSubmit={submit}>
      <h2>Reportar incidente</h2>
      <label htmlFor="t">Título</label>
      <input id="t" value={form.title} onChange={set('title')} placeholder="Ej.: Correo falso pidiendo credenciales" minLength={5} maxLength={120} required />
      <label htmlFor="ty">Tipo</label>
      <select id="ty" value={form.type} onChange={set('type')}>
        {INCIDENT_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label htmlFor="a">Activo afectado</label>
      <input id="a" value={form.asset} onChange={set('asset')} placeholder="Ej.: servidor web, correo institucional" maxLength={120} />
      <label htmlFor="d">Descripción</label>
      <textarea id="d" rows={3} value={form.description} onChange={set('description')} placeholder="¿Qué pasó?" maxLength={2000} />
      <label htmlFor="ev">Evidencia (PNG, JPG, PDF o TXT · máx. 5 MB)</label>
      <input key={fileKey} id="ev" type="file" accept=".png,.jpg,.jpeg,.pdf,.txt,.log" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Reportar'}</button>
      {msg && <p className="muted small" role="status">{msg}</p>}
    </form>
  );
}
