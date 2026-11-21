// Cliente del API Gateway para la app móvil: el mismo backend que la web, mismo JWT.
import * as SecureStore from 'expo-secure-store';

// URL pública del API Gateway (Traefik). En el celular NO sirve "localhost":
// usa la IP de tu PC en la red (ej. https://192.168.1.20) o un túnel HTTPS.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://192.168.1.20';

export type Incident = {
  id: string; title: string; type: string; asset: string; status: string;
  severity: string; triageReasons: string[]; reportedBy: string; createdAt: string;
};
export type User = { username: string; name: string; role: 'admin' | 'analyst' | 'reporter' };

let token: string | null = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync('token'); // guardado cifrado en el dispositivo
  return token;
}

export async function logout() {
  token = null;
  await SecureStore.deleteItemAsync('token');
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export async function login(username: string, password: string) {
  const r = await api<{ token: string; user: User }>('/auth/login', 'POST', { username, password });
  token = r.token;
  await SecureStore.setItemAsync('token', r.token);
  return r.user;
}
