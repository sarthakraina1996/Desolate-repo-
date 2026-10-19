// Two-tone sidebar icons, drawn on a 48-unit grid with soft top-to-bottom gradients.
// Each keeps its own colours (they do not follow the link colour), so the menu reads at a
// glance: blue home, purple folder, red team, green calendar and so on.
import { useId } from 'react';

function useIds(...names) {
  const base = useId().replace(/:/g, '');
  return Object.fromEntries(names.map((n) => [n, `${base}-${n}`]));
}

function Svg({ size = 24, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false" className="nav-ic" shapeRendering="geometricPrecision">
      {children}
    </svg>
  );
}

// Vertical gradient, light at the top.
function Grad({ id, from, to, x2 = 0, y2 = 1 }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

export function DashboardIcon(props) {
  const id = useIds('wall', 'roof', 'door');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.wall} from="#a9bffa" to="#7f9df3" />
        <Grad id={id.roof} from="#2f55e6" to="#1834c4" />
        <Grad id={id.door} from="#2448d8" to="#1530b8" />
      </defs>
      <path d="M9 21.5 24 9.6l15 11.9v15a5.5 5.5 0 0 1-5.5 5.5h-19A5.5 5.5 0 0 1 9 36.5z" fill={`url(#${id.wall})`} />
      <path d="M13.2 23.6 24 15l10.8 8.6v12.6a1.6 1.6 0 0 1-1.6 1.6H14.8a1.6 1.6 0 0 1-1.6-1.6z" fill="#e7eefe" />
      <path d="M5.8 22.4 24 7.6l18.2 14.8" stroke={`url(#${id.roof})`} strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.6 42V31a3 3 0 0 1 3-3h4.8a3 3 0 0 1 3 3v11z" fill={`url(#${id.door})`} />
    </Svg>
  );
}

export function MyWorkIcon(props) {
  const id = useIds('tile', 'dash');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.tile} from="#ecf2ff" to="#dde7fd" />
        <Grad id={id.dash} from="#5a86f6" to="#3a68ee" x2="1" y2="0" />
      </defs>
      <rect x="3.5" y="4" width="41" height="40" rx="10.5" fill={`url(#${id.tile})`} />
      <path d="m12.6 17.4 3.9 3.9 7-7" stroke="#1f3fcf" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.6 29.6 3.9 3.9 7-7" stroke="#1f3fcf" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M28.6 17.9h7.4M28.6 30.1h7.4" stroke={`url(#${id.dash})`} strokeWidth="4.6" strokeLinecap="round" />
    </Svg>
  );
}

export function ProjectsIcon(props) {
  const id = useIds('back', 'front');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.back} from="#9d7ff2" to="#6a45d8" x2="1" y2="0.35" />
        <Grad id={id.front} from="#cdbdfc" to="#b29af8" />
      </defs>
      <path d="M4.5 11.5a5 5 0 0 1 5-5h7.6a4 4 0 0 1 2.9 1.2l3.3 3.4h15.2a5 5 0 0 1 5 5v20.4a5 5 0 0 1-5 5h-29a5 5 0 0 1-5-5z" fill={`url(#${id.back})`} />
      <rect x="10" y="16.2" width="26.5" height="14" rx="2.6" fill="#fbf9ff" />
      <path d="M9 24a3.4 3.4 0 0 1 3.4-3.4h22.9a2.6 2.6 0 0 1 2.6 2.9l-1.7 15.3a3.4 3.4 0 0 1-3.4 2.7H9.5a5 5 0 0 1-.5-.1z" fill={`url(#${id.front})`} />
    </Svg>
  );
}

export function TeamGroupsIcon(props) {
  const id = useIds('mid', 'side', 'gap');
  const midBody = 'M12.8 32.6a10.6 10.6 0 0 1 10.6-10.6h1.2a10.6 10.6 0 0 1 10.6 10.6v6.6a2.8 2.8 0 0 1-2.8 2.8H15.6a2.8 2.8 0 0 1-2.8-2.8z';
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.mid} from="#ff7489" to="#f04661" />
        <Grad id={id.side} from="#f2475e" to="#d81f39" />
        {/* Clear a thin gap around the middle person so the three figures stay separate. */}
        <mask id={id.gap} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <path d={midBody} fill="#000" stroke="#000" strokeWidth="3.4" />
        </mask>
      </defs>
      <g mask={`url(#${id.gap})`}>
        <circle cx="9.8" cy="15.6" r="4.7" fill={`url(#${id.mid})`} />
        <circle cx="38.2" cy="15.6" r="4.7" fill={`url(#${id.mid})`} />
        <path d="M2.4 33a8.4 8.4 0 0 1 8.4-8.4h6.4V41H5.2a2.8 2.8 0 0 1-2.8-2.8z" fill={`url(#${id.side})`} />
        <path d="M45.6 33a8.4 8.4 0 0 0-8.4-8.4h-6.4V41h12a2.8 2.8 0 0 0 2.8-2.8z" fill={`url(#${id.side})`} />
      </g>
      <circle cx="24" cy="11.6" r="6.2" fill={`url(#${id.mid})`} />
      <path d={midBody} fill={`url(#${id.mid})`} />
    </Svg>
  );
}

export function CalendarIcon(props) {
  const id = useIds('body', 'head', 'panel', 'ring');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.body} from="#4fdcae" to="#2bc996" />
        <Grad id={id.head} from="#22cc93" to="#12b781" />
        <Grad id={id.panel} from="#f1fcf8" to="#dcf6ec" />
        <Grad id={id.ring} from="#13a875" to="#0b8f62" />
      </defs>
      <rect x="5" y="8.6" width="38" height="34.4" rx="7.2" fill={`url(#${id.body})`} />
      <path d="M5 15.8a7.2 7.2 0 0 1 7.2-7.2h23.6a7.2 7.2 0 0 1 7.2 7.2v2.6H5z" fill={`url(#${id.head})`} />
      <rect x="9" y="18.4" width="30" height="20.6" rx="2.8" fill={`url(#${id.panel})`} />
      <path d="M15.4 4.2v8.4M32.6 4.2v8.4" stroke={`url(#${id.ring})`} strokeWidth="4.6" strokeLinecap="round" />
      <g fill="#17b17f">
        <rect x="13.6" y="22.6" width="5.6" height="5.2" rx="1.7" />
        <rect x="21.2" y="22.6" width="5.6" height="5.2" rx="1.7" />
        <rect x="28.8" y="22.6" width="5.6" height="5.2" rx="1.7" />
        <rect x="13.6" y="30" width="5.6" height="5.2" rx="1.7" />
        <rect x="21.2" y="30" width="5.6" height="5.2" rx="1.7" />
        <rect x="28.8" y="30" width="5.6" height="5.2" rx="1.7" />
      </g>
    </Svg>
  );
}

export function AssetsIcon(props) {
  const id = useIds('frame', 'panel', 'hill', 'clip');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.frame} from="#ffad3d" to="#ff8a1c" />
        <Grad id={id.panel} from="#fffbf5" to="#ffefd9" />
        <Grad id={id.hill} from="#ffc56b" to="#ffaa42" />
        <clipPath id={id.clip}><rect x="9.2" y="10.8" width="29.6" height="26.4" rx="2.6" /></clipPath>
      </defs>
      <rect x="4" y="5.6" width="40" height="36.8" rx="7.4" fill={`url(#${id.frame})`} />
      <rect x="9.2" y="10.8" width="29.6" height="26.4" rx="2.6" fill={`url(#${id.panel})`} />
      <g clipPath={`url(#${id.clip})`}>
        <path d="M6 39 17.3 27.4a1.6 1.6 0 0 1 2.3 0l4.3 4.4 7-7.8a1.6 1.6 0 0 1 2.4 0L42 34.6V39z" fill={`url(#${id.hill})`} />
      </g>
      <circle cx="17.4" cy="19.2" r="4.3" fill="#ff9a1f" />
    </Svg>
  );
}

export function PastProjectsIcon(props) {
  const id = useIds('arc', 'hand');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.arc} from="#ad92f6" to="#8a66ec" x2="1" y2="1" />
        <Grad id={id.hand} from="#7550e0" to="#5d36cf" />
      </defs>
      {/* From nine o'clock over the top and round to seven o'clock. */}
      <path d="M10.2 24A16 16 0 1 1 18.2 37.86" stroke={`url(#${id.arc})`} strokeWidth="4.6" strokeLinecap="round" />
      <path d="M4.6 22.4h11.2L10.2 29.6z" fill="#9775ef" stroke="#9775ef" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M26.2 14.8v9.6l6.2 5.8" stroke={`url(#${id.hand})`} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Not in the reference set: drawn to match it (who can see what, so a shield with a person).
export function TeamAccessIcon(props) {
  const id = useIds('shield', 'inner', 'person');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.shield} from="#3ccfe0" to="#12a8bd" />
        <Grad id={id.inner} from="#f0fcfd" to="#d6f4f8" />
        <Grad id={id.person} from="#14a0b3" to="#0b8395" />
      </defs>
      <path d="M24 3.6 41 9.8v12.4c0 10.2-7 18.4-17 21.8C14 40.6 7 32.4 7 22.2V9.8z" fill={`url(#${id.shield})`} strokeLinejoin="round" />
      <path d="M24 8.8 36.4 13.4v8.8c0 7.6-5 13.8-12.4 16.7C16.6 36 11.6 29.8 11.6 22.2v-8.8z" fill={`url(#${id.inner})`} />
      <circle cx="24" cy="19.4" r="4.6" fill={`url(#${id.person})`} />
      <path d="M15.6 32.4a8.4 8.4 0 0 1 16.8 0A15.4 15.4 0 0 1 24 38.9a15.4 15.4 0 0 1-8.4-6.5z" fill={`url(#${id.person})`} />
    </Svg>
  );
}

const GEAR = 'M19.13 10.24 L19.42 4.94 L28.58 4.94 L28.87 10.24 L30.29 10.82 L34.24 7.29 L40.71 13.76 L37.18 17.71 L37.76 19.13 L43.06 19.42 L43.06 28.58 L37.76 28.87 L37.18 30.29 L40.71 34.24 L34.24 40.71 L30.29 37.18 L28.87 37.76 L28.58 43.06 L19.42 43.06 L19.13 37.76 L17.71 37.18 L13.76 40.71 L7.29 34.24 L10.82 30.29 L10.24 28.87 L4.94 28.58 L4.94 19.42 L10.24 19.13 L10.82 17.71 L7.29 13.76 L13.76 7.29 L17.71 10.82Z';

export function SettingsIcon(props) {
  const id = useIds('gear', 'hole');
  return (
    <Svg {...props}>
      <defs>
        <Grad id={id.gear} from="#7f8ba1" to="#5f6b82" />
        <mask id={id.hole} maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          <circle cx="24" cy="24" r="6.4" fill="#000" />
        </mask>
      </defs>
      {/* The same-colour stroke with round joins softens every corner of the teeth. */}
      <path d={GEAR} fill={`url(#${id.gear})`} stroke={`url(#${id.gear})`} strokeWidth="2.6" strokeLinejoin="round" mask={`url(#${id.hole})`} />
    </Svg>
  );
}
