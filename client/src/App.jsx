import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';

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

function Guard({ roles, children }) {
  const { user } = useApp();
  if (roles && !roles.includes(user.role)) return <Navigate to={user.role === 'employee' ? '/my' : '/'} replace />;
  return children;
}

export default function App() {
  const { user, meta } = useApp();
  if (user === undefined || (user && !meta)) return <Loading text="Loading BrainADZ HRMS…" />;
  if (!user) return <Login />;
  const HR = ['admin', 'hr'];
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/print/:kind/:id" element={<Print />} />
        <Route path="*" element={(
          <Layout>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={user.role === 'employee' ? <Navigate to="/my" replace /> : <Dashboard />} />
                <Route path="/my" element={<MySpace />} />
                <Route path="/hiring" element={<Guard roles={[...HR, 'manager']}><Hiring /></Guard>} />
                <Route path="/screener" element={<Guard roles={HR}><Screener /></Guard>} />
                <Route path="/employees" element={<Employees />} />
                <Route path="/employees/:id" element={<Employees />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/leave" element={<Leave />} />
                <Route path="/calendar" element={<HolidayCalendar />} />
                <Route path="/payroll" element={<Guard roles={HR}><Payroll /></Guard>} />
                <Route path="/performance" element={<Performance />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/posh" element={<Posh />} />
                <Route path="/resignation" element={<Resignation />} />
                <Route path="/reports" element={<Guard roles={HR}><Reports /></Guard>} />
                <Route path="/settings" element={<Guard roles={HR}><SettingsPage /></Guard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Layout>
        )} />
      </Routes>
    </Suspense>
  );
}
