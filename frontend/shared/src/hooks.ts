import { useCallback, useEffect, useRef, useState } from 'react';
import { on, type UiEvent } from './api';

/** Consulta periódica (polling) + recarga inmediata cuando otro microfrontend avisa un cambio. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, refreshOn: UiEvent[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try { setData(await loadRef.current()); setError(''); } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, intervalMs);
    const offs = refreshOn.map((ev) => on(ev, () => void refresh()));
    return () => { clearInterval(t); offs.forEach((off) => off()); };
  }, [refresh, intervalMs, refreshOn.join()]);

  return { data, error, refresh };
}
