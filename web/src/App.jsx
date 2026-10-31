import { useApp } from './store.jsx';
import { useRouter, match } from './router.jsx';
import { api } from './api.js';
import { Layout, Logo } from './Layout.jsx';
import { Empty } from './ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import Project from './pages/Project.jsx';
import MyWork from './pages/MyWork.jsx';
import CalendarPage from './pages/Calendar.jsx';
import AssetLibrary from './pages/AssetLibrary.jsx';
import PastProjects from './pages/PastProjects.jsx';
import TeamAccess from './pages/TeamAccess.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import TeamGroups from './pages/TeamGroups.jsx';
import { DemoBadge } from './demo/DemoBadge.jsx';

function Routes() {
  const { path } = useRouter();
  let m;
  if (path === '/' || path === '') return <Dashboard />;
  if (path === '/my') return <MyWork />;
  if (path === '/projects') return <Projects />;
  if ((m = match('/projects/:id/tasks/:taskId', path))) return <Project id={m.id} tab="tasks" taskId={m.taskId} />;
  if ((m = match('/projects/:id/:tab', path))) return <Project id={m.id} tab={m.tab} />;
  if ((m = match('/projects/:id', path))) return <Project id={m.id} />;
  if (path === '/teams') return <TeamGroups />;
  if ((m = match('/teams/:id', path))) return <TeamGroups id={m.id} />;
  if (path === '/calendar') return <CalendarPage />;
  if (path === '/assets') return <AssetLibrary />;
  if (path === '/archive') return <PastProjects />;
  if (path === '/team') return <TeamAccess />;
  if ((m = match('/settings/:tab', path))) return <Settings tab={m.tab} />;
  if (path === '/settings') return <Settings />;
  if (path === '/profile') return <Profile />;
  return <div className="card"><Empty title="Page not found">That link does not lead anywhere. Use the menu to find your way.</Empty></div>;
}

function Boot({ label }) {
  return (
    <div className="demo-boot">
      <Logo size="sm" />
      <b>{label}</b>
      <span>Getting your projects ready</span>
      <div className="bar" />
    </div>
  );
}

export default function App() {
  const { boot, bootError, me, loadBoot, setBoot } = useApp();
  const { navigate } = useRouter();
  if (bootError && !boot) {
    return (
      <div className="demo-boot">
        <b>Could not reach the server</b>
        <span>{bootError}</span>
        <button type="button" className="btn primary" onClick={loadBoot}>Try again</button>
      </div>
    );
  }
  if (boot === null) return <Boot label="Loading BrainADZ Projects" />;
  if (boot === false) return <Login />;

  const signOut = async () => {
    if (api.isDemo()) window.__pmDemo.signOut();
    else await api.post('/auth/logout').catch(() => {});
    navigate('/', { replace: true });
    setBoot(false);
  };

  if (me.must_change_password && !api.isDemo()) {
    return (
      <Layout onSignOut={signOut}>
        <Profile forced />
      </Layout>
    );
  }
  return (
    <>
      <Layout onSignOut={signOut}>
        <Routes />
      </Layout>
      <DemoBadge />
    </>
  );
}

