import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Loads `path` and keeps the previous data while reloading to avoid flicker.
export function useApi(path) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState((s) => ({ data: s.data, loading: false, error: e.message })));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
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

// Small form-state helper: const [f, set, setF] = useForm({...}); <input value={f.x} onChange={set('x')} />
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = useCallback((k) => (e) => {
    const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues((s) => ({ ...s, [k]: v }));
  }, []);
  return [values, set, setValues];
}

// Runs an async action with a busy flag and toast feedback.
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const out = await fn();
      if (success && toast) toast(typeof success === 'function' ? success(out) : success, 'success');
      return out;
    } catch (e) {
      if (toast) toast(e.message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}
