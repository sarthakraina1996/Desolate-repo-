// The pages in the main menu, shared by the docked sidebar and the floating menu, so both
// show the same pages, counts and permissions.
import { useApp } from './store.jsx';
import {
  DashboardIcon, MyWorkIcon, ProjectsIcon, TeamGroupsIcon, CalendarIcon, AssetsIcon, PastProjectsIcon, TeamAccessIcon, SettingsIcon,
} from './navIcons.jsx';

// keys: extra words the Quick Access search understands. tint: tile background in Quick Access.
export const NAV = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon, exact: true, keys: 'home overview summary kpi', tint: '#e8effe' },
  { to: '/my', label: 'My Work', icon: MyWorkIcon, count: 'my', keys: 'tasks todo assigned mine due', tint: '#e8effe' },
  { to: '/projects', label: 'Projects', icon: ProjectsIcon, count: 'projects', keys: 'board kanban jobs clients events', tint: '#f0ebff' },
  { to: '/teams', label: 'Team Groups', icon: TeamGroupsIcon, count: 'teams', keys: 'chat messages groups team updates status', tint: '#feecef' },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon, keys: 'dates schedule deadlines events shows launches', tint: '#e5f8f0' },
  { to: '/assets', label: 'Asset Library', icon: AssetsIcon, keys: 'files assets designs photos documents renders', tint: '#fff3e2' },
  { to: '/archive', label: 'Past Projects', icon: PastProjectsIcon, keys: 'archive old history delivered completed', tint: '#f0ebff' },
  { to: '/team', label: 'Team & Access', icon: TeamAccessIcon, admin: true, keys: 'people users access permissions staff', tint: '#e2f7fa' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, manager: true, keys: 'verticals templates company settings', tint: '#eef1f6' },
];

// The pages this person may open.
export function useNavItems() {
  const { isAdmin, manageableVerticals } = useApp();
  return NAV.filter((n) => (!n.admin || isAdmin) && (!n.manager || isAdmin || manageableVerticals.length));
}

export const isActivePath = (n, path) => (n.exact ? path === n.to : path === n.to || path.startsWith(n.to + '/'));

// The number beside a menu item: red while something new is waiting, grey once seen.
export function navCount(n, counts) {
  if (n.count === 'my' && counts.my > 0) {
    return { value: counts.my, fresh: counts.myNew > 0, title: counts.myNew ? `${counts.myNew} newly assigned to you` : `${counts.my} open tasks` };
  }
  if (n.count === 'projects' && counts.projectsNew > 0) {
    return { value: counts.projectsNew, fresh: true, title: `${counts.projectsNew} projects with something new for you` };
  }
  if (n.count === 'teams' && (counts.groupsUnread > 0 || counts.groups > 0)) {
    return {
      value: counts.groupsUnread || counts.groups,
      fresh: counts.groupsUnread > 0,
      title: counts.groupsUnread ? `${counts.groupsUnread} unread messages in your groups` : `${counts.groups} groups`,
    };
  }
  return null;
}

// How many red (new) items are waiting across the menu.
export const freshTotal = (counts) => (counts.myNew || 0) + (counts.projectsNew || 0) + (counts.groupsUnread || 0);

export function CountBadge({ c }) {
  if (!c) return null;
  return <span className={`count ${c.fresh ? '' : 'seen'}`} title={c.title}>{c.value}</span>;
}
