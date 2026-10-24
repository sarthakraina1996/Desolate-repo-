// Routes and the sign-in / demo-preparation gates.
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context.jsx';
import { Shell } from './components/Shell.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Preparing from './pages/Preparing.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Reservations = lazy(() => import('./pages/Reservations.jsx'));
const ReservationDetail = lazy(() => import('./pages/ReservationDetail.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const FrontDesk = lazy(() => import('./pages/FrontDesk.jsx'));
const Rooms = lazy(() => import('./pages/Rooms.jsx'));
const RoomDetail = lazy(() => import('./pages/RoomDetail.jsx'));
const Housekeeping = lazy(() => import('./pages/Housekeeping.jsx'));
const Guests = lazy(() => import('./pages/Guests.jsx'));
const GuestDetail = lazy(() => import('./pages/GuestDetail.jsx'));
const Folio = lazy(() => import('./pages/Folio.jsx'));
const Invoice = lazy(() => import('./pages/Invoice.jsx'));
const Revenue = lazy(() => import('./pages/Revenue.jsx'));
const Finance = lazy(() => import('./pages/Finance.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const Planned = lazy(() => import('./pages/Planned.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

function Home() {
  const { can } = useApp();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('housekeeping.view')) return <Navigate to="/housekeeping" replace />;
  return <Navigate to="/settings/profile" replace />;
}

export default function App() {
  const { session, seeding, user } = useApp();
  if (seeding) return <Preparing progress={seeding} />;
  if (session === undefined) return <Loading text="Starting BrainADZ Hospitality OS…" />;
  if (!session) return <Login />;
  if (user.mfaSetupRequired)
    return (
      <Shell>
        <Suspense fallback={<Loading />}>
          <Settings forceMfa />
        </Suspense>
      </Shell>
    );
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/reservations/:id" element={<ReservationDetail />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/front-desk" element={<FrontDesk />} />
          <Route path="/rooms" element={<Rooms />} />
          <Route path="/rooms/:id" element={<RoomDetail />} />
          <Route path="/housekeeping" element={<Housekeeping />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/guests/:id" element={<GuestDetail />} />
          <Route path="/folios/:id" element={<Folio />} />
          <Route path="/invoices/:id" element={<Invoice />} />
          <Route path="/revenue" element={<Revenue />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/channels" element={<Planned moduleKey="channels" />} />
          <Route path="/pos" element={<Planned moduleKey="pos" />} />
          <Route path="/inventory" element={<Planned moduleKey="inventory" />} />
          <Route path="/operations" element={<Planned moduleKey="operations" />} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
