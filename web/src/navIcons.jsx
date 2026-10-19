// Two-tone sidebar icons. Each keeps its own colours (they do not follow the link colour),
// so the menu reads at a glance: blue home, purple folders, red team, green calendar and so on.

function Svg({ size = 24, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className="nav-ic">
      {children}
    </svg>
  );
}

export function DashboardIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.9 10.4V18.6A2.4 2.4 0 0 0 7.3 21h9.4a2.4 2.4 0 0 0 2.4-2.4v-8.2" fill="#dbe6fd" stroke="#8ba8f5" strokeWidth="2" />
      <path d="M2.6 11.4 12 3.5l9.4 7.9" stroke="#1d3fd1" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.9 21v-4.3a2.1 2.1 0 0 1 4.2 0V21z" fill="#1d3fd1" />
    </Svg>
  );
}

export function MyWorkIcon(props) {
  return (
    <Svg {...props}>
      <rect x="1.8" y="2" width="20.4" height="20" rx="5.2" fill="#e2ebfd" />
      <path d="m6 8.3 1.6 1.6 3-3" stroke="#1d3fd1" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m6 14.9 1.6 1.6 3-3" stroke="#1d3fd1" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.3 8.7h4.6M13.3 15.3h4.6" stroke="#4a78f0" strokeWidth="2.3" strokeLinecap="round" />
    </Svg>
  );
}

export function ProjectsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M2 6.4A2.4 2.4 0 0 1 4.4 4h4.1c.7 0 1.3.3 1.8.8l1.4 1.5h7.9A2.4 2.4 0 0 1 22 8.7v9.9a2.4 2.4 0 0 1-2.4 2.4H4.4A2.4 2.4 0 0 1 2 18.6z" fill="#8a62e8" />
      <path d="M20.6 8.7v12.1A2.4 2.4 0 0 0 22 18.6V8.7a2.4 2.4 0 0 0-1.4-2.2z" fill="#6b43d6" />
      <path d="M4 10.9a1.9 1.9 0 0 1 1.9-1.9h12.6a1.6 1.6 0 0 1 1.6 1.7l-.4 8.4A2 2 0 0 1 17.7 21H4.4A2.4 2.4 0 0 1 2.9 20.5z" fill="#c4b2fb" />
    </Svg>
  );
}

export function TeamGroupsIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="8.4" r="2.4" fill="#e8243f" />
      <circle cx="18.5" cy="8.4" r="2.4" fill="#e8243f" />
      <path d="M1.4 17.9a4.2 4.2 0 0 1 4.2-4.2h1.1c.6 0 1.1.1 1.6.3a5.7 5.7 0 0 0-1.3 3.7V20H2.5a1.1 1.1 0 0 1-1.1-1.1z" fill="#e8243f" />
      <path d="M22.6 17.9a4.2 4.2 0 0 0-4.2-4.2h-1.1c-.6 0-1.1.1-1.6.3a5.7 5.7 0 0 1 1.3 3.7V20h4.5a1.1 1.1 0 0 0 1.1-1.1z" fill="#e8243f" />
      <circle cx="12" cy="6.6" r="3.3" fill="#fb5b70" />
      <path d="M6.6 17.9a4.7 4.7 0 0 1 4.7-4.7h1.4a4.7 4.7 0 0 1 4.7 4.7v2a1.1 1.1 0 0 1-1.1 1.1H7.7a1.1 1.1 0 0 1-1.1-1.1z" fill="#fb5b70" />
    </Svg>
  );
}

export function CalendarIcon(props) {
  return (
    <Svg {...props}>
      <rect x="2.6" y="4.2" width="18.8" height="17.6" rx="3.6" fill="#3fd6a2" />
      <path d="M2.6 7.8a3.6 3.6 0 0 1 3.6-3.6h11.6a3.6 3.6 0 0 1 3.6 3.6v1.5H2.6z" fill="#13c08a" />
      <rect x="4.6" y="10.9" width="14.8" height="9" rx="1.8" fill="#d5f7eb" />
      <path d="M7.7 2.4v4M16.3 2.4v4" stroke="#0e9f70" strokeWidth="2.2" strokeLinecap="round" />
      <g fill="#14b981">
        <rect x="7" y="12.6" width="2.4" height="2.2" rx=".7" />
        <rect x="10.8" y="12.6" width="2.4" height="2.2" rx=".7" />
        <rect x="14.6" y="12.6" width="2.4" height="2.2" rx=".7" />
        <rect x="7" y="16.3" width="2.4" height="2.2" rx=".7" />
        <rect x="10.8" y="16.3" width="2.4" height="2.2" rx=".7" />
        <rect x="14.6" y="16.3" width="2.4" height="2.2" rx=".7" />
      </g>
    </Svg>
  );
}

export function AssetsIcon(props) {
  return (
    <Svg {...props}>
      <rect x="2.2" y="2.6" width="19.6" height="18.8" rx="3.6" fill="#ff9f1c" />
      <rect x="4.4" y="4.8" width="15.2" height="14.4" rx="1.8" fill="#fff3e0" />
      <circle cx="9" cy="9.3" r="1.9" fill="#f59e0b" />
      <path d="M4.4 17.4 8.9 13l2.6 2.4 3.9-4.1 4.2 4.6v1.5a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8z" fill="#fdba55" />
    </Svg>
  );
}

export function PastProjectsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.3 9.2A8.4 8.4 0 1 1 3.6 13" stroke="#a88bf3" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M1.6 9.6 4.4 12.6 7.3 9.8" stroke="#9471ee" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.6 7.6V12.4l3.1 2.4" stroke="#6b43d6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Not in the reference set: drawn to match it (people and their access, so a shield).
export function TeamAccessIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 2.2 20 5.3v6.1c0 5-3.4 8.9-8 10.4-4.6-1.5-8-5.4-8-10.4V5.3z" fill="#c6eef4" stroke="#22b4c8" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="9.6" r="2.4" fill="#0e8fa3" />
      <path d="M7.9 16.6a4.1 4.1 0 0 1 8.2 0 8.3 8.3 0 0 1-4.1 3.1 8.3 8.3 0 0 1-4.1-3.1z" fill="#0e8fa3" />
    </Svg>
  );
}

export function SettingsIcon(props) {
  return (
    <Svg {...props}>
      <path
        d="M10.3 1.9h3.4l.6 2.7c.7.2 1.4.5 2 .9l2.4-1.5 2.4 2.4-1.5 2.4c.4.6.7 1.3.9 2l2.7.6v3.4l-2.7.6c-.2.7-.5 1.4-.9 2l1.5 2.4-2.4 2.4-2.4-1.5c-.6.4-1.3.7-2 .9l-.6 2.7h-3.4l-.6-2.7c-.7-.2-1.4-.5-2-.9l-2.4 1.5-2.4-2.4 1.5-2.4c-.4-.6-.7-1.3-.9-2l-2.7-.6v-3.4l2.7-.6c.2-.7.5-1.4.9-2L3.9 6.4l2.4-2.4 2.4 1.5c.6-.4 1.3-.7 2-.9z"
        fill="#6e7a8e" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.4" fill="#fff" />
    </Svg>
  );
}
