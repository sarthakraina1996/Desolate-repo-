import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Loads a GET endpoint; keeps the previous data while refetching (no layout jump).
export function useApi(path, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path || !enabled) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path);
      if (n === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (n === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path, enabled]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

// Remembers a small per-browser preference (tab, view); never business data.
export function usePref(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`bhos:${key}`);
      return s == null ? initial : JSON.parse(s);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) => {
      setV(next);
      try {
        localStorage.setItem(`bhos:${key}`, JSON.stringify(next));
      } catch {
        /* storage unavailable: keep in memory */
      }
    },
    [key],
  );
  return [v, set];
}
