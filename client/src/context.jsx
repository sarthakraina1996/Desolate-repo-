import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import { setTimeZone } from './lib/format.js';
import { clearWorkday } from './lib/workday.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const VKEY = 'hrms.vertical';
const readVertical = () => {
  try {
    return Number(localStorage.getItem(VKEY)) || null;
  } catch {
    return null;
  }
};

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [info, setInfo] = useState({});
  const [meta, setMeta] = useState(null);
  const [vertical, setVerticalState] = useState(readVertical);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((text, kind = 'info') => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id: tid, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), kind === 'error' ? 5500 : 3500);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      setUser(me.user);
      setInfo({ companyName: me.companyName, demo: me.demo, ai: me.ai });
      const m = await api.get('/meta');
      setTimeZone(m.settings.timezone);
      setMeta(m);
    } catch {
      setUser(null);
      setMeta(null);
    }
  }, []);

  const refreshMeta = useCallback(async () => setMeta(await api.get('/meta')), []);

  useEffect(() => {
    loadMe();
    const h = () => setUser(null);
    window.addEventListener('hrms:unauthorized', h);
    return () => window.removeEventListener('hrms:unauthorized', h);
  }, [loadMe]);

  const setVertical = useCallback((v) => {
    setVerticalState(v);
    try {
      if (v) localStorage.setItem(VKEY, String(v));
      else localStorage.removeItem(VKEY);
    } catch { /* storage unavailable */ }
  }, []);

  // pause: stop the work clock; the next sign-in asks the reason for the gap.
  const logout = useCallback(async ({ pause = false } = {}) => {
    try { await api.post('/auth/logout', { pause }); } catch { /* ignore */ }
    clearWorkday();
    setUser(null);
    setMeta(null);
  }, []);

  const value = useMemo(() => {
    const role = user?.role;
    return {
      user, info, meta, vertical, setVertical, toast, loadMe, refreshMeta, logout,
      isHR: role === 'admin' || role === 'hr',
      isAdmin: role === 'admin',
      isManager: role === 'manager',
      isEmployeeOnly: role === 'employee',
      employeeName: (eid) => meta?.employees.find((e) => e.id === eid)?.name || '',
      verticalById: (vid) => meta?.verticals.find((v) => v.id === vid),
    };
  }, [user, info, meta, vertical, setVertical, toast, loadMe, refreshMeta, logout]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </AppCtx.Provider>
  );
}
