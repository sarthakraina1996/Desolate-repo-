import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

// Loads `path` and keeps the previous data while reloading to avoid flicker.
export function useApi(path) {
  const [state, setState] = useState({ data: null, loading: Boolean(path), error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // No path yet (e.g. waiting on a selection): nothing to load.
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    // Ignore a response that lands after unmount or after the path changed.
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
  // Patches the loaded data locally (value or updater fn) without refetching.
  const setData = useCallback(
    (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })),
    [],
  );
  return { ...state, reload, setData };
}

// For lists that scroll without a visible scrollbar: which ends have more items past them
// ('more-above', 'more-below'), so the list can fade at that edge. Spread the result on the list.
export function useScrollEdges() {
  const [edges, setEdges] = useState('');
  const el = useRef(null);
  const watcher = useRef(null);
  const onScroll = useCallback(() => {
    const n = el.current;
    if (!n) return;
    const up = n.scrollTop > 1;
    const down = n.scrollTop + n.clientHeight < n.scrollHeight - 1;
    setEdges([up && 'more-above', down && 'more-below'].filter(Boolean).join(' '));
  }, []);
  // Callback ref: re-checks the edges whenever the list or one of its items changes size.
  const ref = useCallback(
    (node) => {
      watcher.current?.disconnect();
      el.current = node;
      if (!node) return;
      onScroll();
      if (typeof ResizeObserver === 'undefined') return;
      watcher.current = new ResizeObserver(onScroll);
      watcher.current.observe(node);
      for (const child of node.children) watcher.current.observe(child);
    },
    [onScroll],
  );
  return { ref, edges, onScroll };
}

// Returns `value` only once it has stopped changing for `ms` (e.g. search boxes).
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Returns a ref; calls `onOutside` when the user presses the mouse outside that element.
export function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      // Dialogs are drawn at the top of the page, outside the panel that opened them, so a
      // click inside one must not close that panel (and the dialog with it).
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.overlay'))
        onOutside();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

// Small form-state helper: const [f, set, setF] = useForm({...}); <input value={f.x} onChange={set('x')} />
export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const set = useCallback(
    (k) => (e) => {
      const v =
        e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
      setValues((s) => ({ ...s, [k]: v }));
    },
    [],
  );
  return [values, set, setValues];
}

// Runs an async action with a busy flag and toast feedback.
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    // `success` is a toast message, or a function that builds one from the result.
    async (fn, success) => {
      setBusy(true);
      try {
        const out = await fn();
        if (success && toast)
          toast(typeof success === 'function' ? success(out) : success, 'success');
        return out;
      } catch (e) {
        if (toast) toast(e.message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy];
}
