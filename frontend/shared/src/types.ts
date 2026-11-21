// Contratos de datos compartidos por el shell y los microfrontends (TypeScript).
export type Role = 'admin' | 'analyst' | 'reporter';
export type Severity = 'Pendiente' | 'Baja' | 'Media' | 'Alta' | 'Crítica' | 'Info';
export type Status = 'Nuevo' | 'Clasificado' | 'En análisis' | 'Resuelto';

export interface User { username: string; name: string; role: Role }

export interface Incident {
  id: string; title: string; type: string; description: string; asset: string;
  status: Status; severity: Severity; triageReasons: string[]; reportedBy: string;
  evidenceName?: string; createdAt: string; updatedAt: string;
}

export interface Notification { id: string; incidentId: string; severity: Severity; message: string; read: boolean; createdAt: string }

export interface AuditEntry { id: string; type: string; source: string; timestamp: string; incidentId?: string; data: Record<string, unknown> }

export interface AuditStats { totalEvents: number; byType: Record<string, number>; bySeverity: Record<string, number>; source: string }

/** Props que el shell entrega a cada microfrontend. */
export interface MfeProps { user: User }

export const INCIDENT_TYPES: Array<[string, string]> = [
  ['phishing', 'Phishing'], ['malware', 'Malware'], ['ransomware', 'Ransomware'],
  ['acceso_no_autorizado', 'Acceso no autorizado'], ['ddos', 'DDoS'], ['fuga_de_datos', 'Fuga de datos'], ['otro', 'Otro'],
];

/** Transiciones manuales permitidas (igual que en Incident Service). */
export const NEXT_STATUS: Record<Status, Status[]> = {
  Nuevo: [], Clasificado: ['En análisis'], 'En análisis': ['Resuelto'], Resuelto: ['En análisis'],
};
