// Routes for every web surface: public event site, browser pass, organiser console,
// exhibitor workspace, gate scanner and venue displays. One sign-in and one permission
// model serve them all; the server decides what each person may see.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { get, post } from './api.js';
import { Loading, ToastHost } from './ui.jsx';
import {
  Account,
  AgendaPage,
  Directory,
  EventSite,
  ExhibitApply,
  Home,
  Landing,
  MapPage,
  PassPage,
  Pay,
  Register,
  SignIn,
} from './public/pages.jsx';
import OrgShell, { OrgHome } from './org/OrgShell.jsx';
import ExhShell from './exh/ExhShell.jsx';
import Scanner from './gate/Scanner.jsx';
import Display from './public/Display.jsx';

const MeCtx = createContext(null);
export const useMe = () => useContext(MeCtx);

// Sends signed-out visitors to sign in, then back to where they were going.
export function RequireUser({ children }) {
  const { me } = useMe();
  const loc = useLocation();
  if (!me.user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(null);
  const refresh = useCallback(() => get('/me').then((m) => (setMe(m), m)), []);
  useEffect(() => {
    refresh().catch(() => setMe({ user: null }));
    get('/auth/config')
      .then(setConfig)
      .catch(() => setConfig({}));
  }, [refresh]);
  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setMe({ user: null });
  }, []);
  if (!me || !config) return <Loading />;
  return (
    <MeCtx.Provider value={{ me, config, refresh, signOut }}>
      <ToastHost>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/e/:slug" element={<EventSite />}>
            <Route index element={<Landing />} />
            <Route path="exhibitors" element={<Directory />} />
            <Route path="map" element={<MapPage />} />
            <Route path="agenda" element={<AgendaPage />} />
            <Route path="register" element={<Register />} />
            <Route
              path="exhibit"
              element={
                <RequireUser>
                  <ExhibitApply />
                </RequireUser>
              }
            />
          </Route>
          <Route path="/p/:token" element={<PassPage />} />
          <Route path="/pay/:intent" element={<Pay />} />
          <Route path="/signin" element={<SignIn />} />
          <Route
            path="/account"
            element={
              <RequireUser>
                <Account />
              </RequireUser>
            }
          />
          <Route
            path="/org"
            element={
              <RequireUser>
                <OrgHome />
              </RequireUser>
            }
          />
          <Route
            path="/org/:eid/*"
            element={
              <RequireUser>
                <OrgShell />
              </RequireUser>
            }
          />
          <Route
            path="/x/:xid/*"
            element={
              <RequireUser>
                <ExhShell />
              </RequireUser>
            }
          />
          <Route
            path="/gate"
            element={
              <RequireUser>
                <Scanner />
              </RequireUser>
            }
          />
          <Route path="/display/:slug/:kiosk" element={<Display />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastHost>
    </MeCtx.Provider>
  );
}
