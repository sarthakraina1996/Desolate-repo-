import { Component, lazy, Suspense, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './context.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import { OfflineBanner } from './components/InstallApp.jsx';
import AppPicker from './components/AppPicker.jsx';
import { appChosen, clearAppFlags, pickPending, wantsProjects } from './lib/apps.js';

// Pages are split into their own chunks and loaded on first visit.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const MySpace = lazy(() => import('./pages/MySpace.jsx'));
const Hiring = lazy(() => import('./pages/Hiring.jsx'));
const Screener = lazy(() => import('./pages/Screener.jsx'));
const Employees = lazy(() => import('./pages/Employees.jsx'));
const Leave = lazy(() => import('./pages/Leave.jsx'));
const Payroll = lazy(() => import('./pages/Payroll.jsx'));
const Performance = lazy(() => import('./pages/Performance.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
const Posh = lazy(() => import('./pages/Posh.jsx'));
const Resignation = lazy(() => import('./pages/Resignation.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const Print = lazy(() => import('./pages/Print.jsx'));
const Documents = lazy(() => import('./pages/Documents.jsx'));
const HolidayCalendar = lazy(() => import('./pages/HolidayCalendar.jsx'));
const Training = lazy(() => import('./pages/Training.jsx'));

// Redirects users whose role is not allowed back to their own home page.
function Guard({ roles, children }) {
  const { user } = useApp();
  if (roles && !roles.includes(user.role))
    return <Navigate to={user.role === 'employee' ? '/my' : '/'} replace />;
  return children;
}

// A page that cannot load (most often its code, while offline) shows a message, not a blank app.
class PageBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Going to another page clears the message (without rebuilding the page, which would drop
  // dialogs that stay open across a navigation, such as a new employee's temporary password).
  componentDidUpdate(prev) {
    if (prev.path !== this.props.path && this.state.failed) this.setState({ failed: false });
  }

  // Renders the page, or a retry card worded for offline vs. a broken page.
  render() {
    if (!this.state.failed) return this.props.children;
    const offline = navigator.onLine === false;
    return (
      <div
        className="card"
        style={{ padding: 28, maxWidth: 520, margin: '40px auto', textAlign: 'center' }}
      >
        <h3 style={{ marginBottom: 8 }}>
          {offline ? 'This page needs a connection' : 'This page could not open'}
        </h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          {offline
            ? 'Connect to the internet or office Wi-Fi, then try again.'
            : 'Reload the app and try again.'}
        </p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
}

// Root component: the offline banner above the app's routes.
export default function App() {
  return (
    <>
      <OfflineBanner />
      <AppRoutes />
    </>
  );
}

// All app routes; shows the login page when signed out and role-guards HR-only pages.
function AppRoutes() {
  const { user, meta } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Where this visit began: opening the home address lands on the app picker.
  const startPath = useRef(pathname).current;
  // Bumped when someone picks HRMS, so the picker gives way to the app.
  const [, setPicked] = useState(0);
  // Wait for the sign-in check and the shared lookup data before rendering any page
  if (user === undefined || (user && !meta)) return <Loading text="Loading BrainADZ HRMS…" />;
  if (!user) return <Login />;
  // With Projects connected, the app picker is the landing page: after signing in, when a visit
  // starts at the home address, and at /apps. Links to a page go straight there. Any forced
  // password change comes first.
  const landing = !appChosen() && (pickPending() || ['/', '/my'].includes(startPath));
  if (
    meta.projectsUrl &&
    !user.mustChangePassword &&
    (wantsProjects() || landing || pathname === '/apps')
  )
    return (
      <AppPicker
        direct={wantsProjects()}
        onHrms={() => {
          clearAppFlags();
          if (pathname === '/apps') navigate('/', { replace: true });
          else setPicked((n) => n + 1);
        }}
      />
    );
  const HR = ['admin', 'hr'];
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Printable documents open without the sidebar layout */}
        <Route path="/print/:kind/:id" element={<Print />} />
        {/* Every other page renders inside the layout */}
        <Route
          path="*"
          element={
            <Layout>
              <PageBoundary path={pathname}>
                <Suspense fallback={<Loading />}>
                  <Routes>
                    {/* Employees land on My Space; everyone else on the dashboard */}
                    <Route
                      path="/"
                      element={
                        user.role === 'employee' ? <Navigate to="/my" replace /> : <Dashboard />
                      }
                    />
                    <Route path="/my" element={<MySpace />} />
                    <Route
                      path="/hiring"
                      element={
                        <Guard roles={[...HR, 'manager']}>
                          <Hiring />
                        </Guard>
                      }
                    />
                    <Route
                      path="/screener"
                      element={
                        <Guard roles={HR}>
                          <Screener />
                        </Guard>
                      }
                    />
                    <Route path="/employees" element={<Employees />} />
                    <Route path="/employees/:id" element={<Employees />} />
                    <Route path="/documents" element={<Documents />} />
                    <Route path="/leave" element={<Leave />} />
                    <Route path="/calendar" element={<HolidayCalendar />} />
                    <Route
                      path="/payroll"
                      element={
                        <Guard roles={HR}>
                          <Payroll />
                        </Guard>
                      }
                    />
                    <Route path="/performance" element={<Performance />} />
                    <Route path="/training" element={<Training />} />
                    <Route path="/attendance" element={<Attendance />} />
                    <Route path="/posh" element={<Posh />} />
                    <Route path="/resignation" element={<Resignation />} />
                    <Route
                      path="/reports"
                      element={
                        <Guard roles={HR}>
                          <Reports />
                        </Guard>
                      }
                    />
                    <Route
                      path="/settings"
                      element={
                        <Guard roles={HR}>
                          <SettingsPage />
                        </Guard>
                      }
                    />
                    {/* Unknown paths go back home */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </PageBoundary>
            </Layout>
          }
        />
      </Routes>
    </Suspense>
  );
}
