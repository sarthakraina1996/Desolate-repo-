import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './lib/api.js';
import { setTimeZone } from './lib/format.js';
import { clearWorkday } from './lib/workday.js';
import Toasts from './components/Toasts.jsx';
import { moduleFor } from './components/icons.jsx';

const AppCtx = createContext(null);
// Reads the app-wide state: signed-in user, lookup data, toasts and session actions.
export const useApp = () => useContext(AppCtx);

// The vertical picked in the switcher is remembered on this device.
const VKEY = 'hrms.vertical';
// Reads the saved vertical id, or null when none is saved or storage is blocked.
const readVertical = () => {
  try {
    return Number(localStorage.getItem(VKEY)) || null;
  } catch {
    return null;
  }
};

// Holds the session, shared lookup data and toasts, and provides them to the whole app.
export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [info, setInfo] = useState({});
  const [meta, setMeta] = useState(null);
  const [vertical, setVerticalState] = useState(readVertical);
  const [toasts, setToasts] = useState([]);
  // Lets event listeners read the current user without re-subscribing.
  const userRef = useRef(user);
  userRef.current = user;

  // A message takes the look of the section it was raised in (or opts.module, a section path such
  // as '/attendance', for messages that belong elsewhere); it closes itself when its countdown ends.
  const { pathname } = useLocation();
  const here = useRef(pathname);
  here.current = pathname;
  const toast = useCallback((text, kind = 'info', opts = {}) => {
    const tid = Math.random().toString(36).slice(2);
    setToasts((t) => [
      ...t.slice(-3),
      { id: tid, text, kind, module: moduleFor(opts.module || here.current) },
    ]);
  }, []);
  const dropToast = useCallback((tid) => setToasts((t) => t.filter((x) => x.id !== tid)), []);

  // Loads the signed-in user, then the lookup data; any failure counts as signed out.
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

  // Reloads the lookup data after settings, employees or verticals change.
  const refreshMeta = useCallback(async () => setMeta(await api.get('/meta')), []);

  // Check the session on start and sign out whenever the API answers 401.
  useEffect(() => {
    loadMe();
    const h = () => setUser(null);
    window.addEventListener('hrms:unauthorized', h);
    // Opened without a connection, the app could not check the sign-in; check again once back.
    const back = () => userRef.current === null && loadMe();
    window.addEventListener('online', back);
    return () => {
      window.removeEventListener('hrms:unauthorized', h);
      window.removeEventListener('online', back);
    };
  }, [loadMe]);

  // Switches the selected vertical and remembers it on this device.
  const setVertical = useCallback((v) => {
    setVerticalState(v);
    try {
      if (v) localStorage.setItem(VKEY, String(v));
      else localStorage.removeItem(VKEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // pause: stop the work clock; the next sign-in asks the reason for the gap.
  const logout = useCallback(async ({ pause = false } = {}) => {
    try {
      await api.post('/auth/logout', { pause });
    } catch {
      /* ignore */
    }
    clearWorkday();
    setUser(null);
    setMeta(null);
  }, []);

  // Context value with role flags and name/vertical lookup helpers.
  const value = useMemo(() => {
    const role = user?.role;
    return {
      user,
      info,
      meta,
      vertical,
      setVertical,
      toast,
      loadMe,
      refreshMeta,
      logout,
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
      <Toasts toasts={toasts} onDone={dropToast} />
    </AppCtx.Provider>
  );
}
