import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';

const AppCtx = createContext(null);
const RANK = { viewer: 1, member: 2, manager: 3 };

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function writePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
export const usePref = (key, fallback) => {
  const [v, setV] = useState(() => readPref(key, fallback));
  const set = useCallback((x) => {
    setV(x);
    writePref(key, x);
  }, [key]);
  return [v, set];
};

export function AppProvider({ children }) {
  const [boot, setBoot] = useState(null); // null = loading, false = signed out
  const [bootError, setBootError] = useState(null);
  const [vertical, setVerticalRaw] = useState(() => readPref('bpm.vertical', null));
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [version, setVersion] = useState(0); // bump to make pages reload their data
  const [countsVersion, setCountsVersion] = useState(0); // bump to refresh sidebar counts only

  const loadBoot = useCallback(async () => {
    try {
      const b = await api.get('/bootstrap');
      setBoot(b);
      setBootError(null);
      return b;
    } catch (e) {
      if (e.status === 401) setBoot(false);
      else setBootError(e.message);
      return null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setBoot(false));
    loadBoot();
  }, [loadBoot]);

  const setVertical = useCallback((v) => {
    setVerticalRaw(v);
    writePref('bpm.vertical', v);
  }, []);

  // Drop a remembered vertical filter the person can no longer see.
  useEffect(() => {
    if (boot && vertical && !boot.verticals.some((v) => v.id === vertical)) setVertical(null);
  }, [boot, vertical, setVertical]);

  const toast = useCallback((message, type = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const bumpCounts = useCallback(() => setCountsVersion((v) => v + 1), []);
  // Records that I have opened a tab, so its count turns from red to grey.
  const markSeen = useCallback(async (scope) => {
    try {
      await api.post('/seen', { scope });
      setCountsVersion((v) => v + 1);
    } catch {
      /* not critical */
    }
  }, []);

  const value = useMemo(() => {
    const users = boot?.users || [];
    const verticals = boot?.verticals || [];
    const me = boot?.me;
    const userById = (id) => users.find((u) => u.id === id);
    const verticalById = (id) => verticals.find((v) => v.id === id);
    const levelIn = (vid) => me?.access?.[vid] || null;
    return {
      boot, bootError, loadBoot, setBoot,
      me, users, verticals, today: boot?.today, categories: boot?.categories || [], templates: boot?.templates || [],
      company: boot?.settings?.company_name || 'BrainADZ',
      isAdmin: me?.role === 'admin',
      vertical, setVertical,
      userById, verticalById, levelIn,
      canManage: (vid) => me?.role === 'admin' || levelIn(vid) === 'manager',
      manageableVerticals: verticals.filter((v) => me?.role === 'admin' || levelIn(v.id) === 'manager'),
      // People who can be assigned work in a vertical.
      assignable: (vid) => users.filter((u) => u.role === 'admin' || RANK[u.access?.[vid]] >= RANK.member),
      toast, confirm, version, refresh, countsVersion, bumpCounts, markSeen,
    };
  }, [boot, bootError, loadBoot, vertical, setVertical, toast, confirm, version, refresh, countsVersion, bumpCounts, markSeen]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
      {confirmState && <ConfirmDialog state={confirmState} close={() => setConfirmState(null)} />}
    </AppCtx.Provider>
  );
}

function ConfirmDialog({ state, close }) {
  const btn = useRef(null);
  useEffect(() => btn.current?.focus(), []);
  const done = (v) => {
    state.resolve(v);
    close();
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && done(false)} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-body">
          <h3 id="confirm-title" style={{ fontSize: 18 }}>{state.title}</h3>
          {state.message && <p className="muted mt-8" style={{ lineHeight: 1.5 }}>{state.message}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => done(false)}>Cancel</button>
          <button ref={btn} type="button" className={`btn ${state.danger ? 'solid-red' : 'primary'}`} onClick={() => done(true)}>
            {state.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const useApp = () => useContext(AppCtx);

// Loads data and reloads when deps change or when something calls refresh().
export function useLoad(fn, deps = []) {
  const { version } = useApp();
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async ({ quiet = false } = {}) => {
    const n = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      if (n === seq.current) setState({ data, loading: false, error: null });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ data: s.data, loading: false, error: e }));
    }
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const setData = useCallback((upd) => setState((s) => ({ ...s, data: typeof upd === 'function' ? upd(s.data) : upd })), []);
  return { ...state, reload, setData };
}
