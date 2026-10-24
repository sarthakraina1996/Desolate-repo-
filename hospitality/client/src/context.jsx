// App-wide state: the signed-in user, their properties, the selected property scope, toasts,
// connectivity and the demo-preparation progress.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import { usePref } from './lib/hooks.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [toasts, setToasts] = useState([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [seeding, setSeeding] = useState(null);
  const [scope, setScope] = usePref('scope', 'all');

  const toast = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get('/auth/me'));
      setSeeding(null);
    } catch (e) {
      if (e.code === 'seeding') return;
      setSession(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = () => setOnline(false);
    const on = () => setOnline(true);
    const unauth = () => setSession(null);
    const seed = (e) => setSeeding(e.detail || {});
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    window.addEventListener('bhos:offline', off);
    window.addEventListener('bhos:online', on);
    window.addEventListener('bhos:unauthorized', unauth);
    window.addEventListener('bhos:seeding', seed);
    return () => {
      for (const [n, f] of [['offline', off], ['online', on], ['bhos:offline', off], ['bhos:online', on], ['bhos:unauthorized', unauth], ['bhos:seeding', seed]])
        window.removeEventListener(n, f);
    };
  }, [refresh]);

  // While the demo is generated, poll until it is ready.
  useEffect(() => {
    if (!seeding) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [seeding, refresh]);

  const user = session?.user ?? null;
  const properties = session?.properties ?? [];
  const can = useCallback((p) => Boolean(user?.permissions?.includes(p)), [user]);
  // Scope is 'all' or one property id; single-property users are pinned to their property.
  const effectiveScope = properties.length === 1 ? String(properties[0].id) : scope === 'all' || properties.some((p) => String(p.id) === String(scope)) ? String(scope) : 'all';
  const property = effectiveScope === 'all' ? null : properties.find((p) => String(p.id) === effectiveScope) || null;
  // Operational screens need one property: the selected one, or the first.
  const opProperty = property || properties[0] || null;

  const value = useMemo(
    () => ({
      session,
      user,
      properties,
      can,
      scope: effectiveScope,
      setScope,
      property,
      opProperty,
      refresh,
      setSession,
      toast,
      toasts,
      online,
      seeding,
    }),
    [session, user, properties, can, effectiveScope, setScope, property, opProperty, refresh, toast, toasts, online, seeding],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
