// Cliente HTTP: TODAS las llamadas van al API Gateway (/api) con el JWT en la cabecera.
// El token vive en sessionStorage del origen del shell, así que los microfrontends
// (que se ejecutan dentro del shell) lo comparten sin acoplarse entre sí.
import type { User } from './types';

const TOKEN = 'sentinel.token';
const USER = 'sentinel.user';

export const session = {
  token: () => sessionStorage.getItem(TOKEN),
  user: (): User | null => JSON.parse(sessionStorage.getItem(USER) ?? 'null'),
  save(token: string, user: User) { sessionStorage.setItem(TOKEN, token); sessionStorage.setItem(USER, JSON.stringify(user)); },
  clear() { sessionStorage.removeItem(TOKEN); sessionStorage.removeItem(USER); emit('sentinel:logout'); },
};

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = session.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') session.clear();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Error ${res.status}`, res.status);
  return data as T;
}

/** Descarga un archivo protegido (necesita el JWT, por eso no basta un <a href>). */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${session.token() ?? ''}` } });
  if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// Comunicación entre microfrontends: eventos del navegador (desacoplados, sin imports cruzados).
export type UiEvent = 'sentinel:incidents-changed' | 'sentinel:logout';
export function emit(name: UiEvent) { window.dispatchEvent(new CustomEvent(name)); }
export function on(name: UiEvent, fn: () => void) {
  window.addEventListener(name, fn);
  return () => window.removeEventListener(name, fn);
}
