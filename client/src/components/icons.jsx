// The BrainADZ HRMS icon set: colourful duotone icons for the sidebar and
// navy outline icons for the top bar, drawn on a 24 x 24 grid.
// Icon palette; the module themes below reuse these colours.
const C = {
  red: '#F2183C',
  redSoft: '#FDDDE6',
  blue: '#0A62E6',
  blueSoft: '#C6DCFD',
  sky: '#1AABE6',
  skySoft: '#BDE6F7',
  violet: '#6340F2',
  violetSoft: '#E6DEFF',
  violetBar: '#8657F2',
  orange: '#FD8A0F',
  orangeSoft: '#FDDAB6',
  paper: '#FFF4E6',
  paperLine: '#F9C98F',
  green: '#00B562',
  greenSoft: '#D2F3E6',
  pink: '#F0336F',
  pinkSoft: '#FDE6F0',
  pinkMid: '#FB86AB',
  palm: '#E8174E',
  card: '#1A7AFD',
  cardSoft: '#C9DEFD',
  clock: '#0E7AFD',
  clockSoft: '#E6F2FD',
  hands: '#123F91',
  magenta: '#D81B9C',
  magentaSoft: '#F8CDEB',
  ember: '#F9481A',
  emberSoft: '#FDE6DA',
  mint1: '#45C99E',
  mint2: '#22BE8C',
  mint3: '#00B07F',
  slate: '#4A627A',
  slateSoft: '#D3DDE8',
  indigo: '#3346B8',
  indigoSoft: '#DCE3FB',
  navy: '#22314A',
  live: '#E92A36',
  statusGreen: '#2BA352',
  statusHalo: '#D4EEDD',
  peach: '#FADCCF',
  exhibits: '#22A04B',
};

// Shared 24 x 24 SVG wrapper; hidden from screen readers unless given a `title`.
function Svg({ size = 24, title, children, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// Gear outline with `teeth` teeth, as a closed polygon (round joins soften it).
function gear(cx, cy, rOut, rIn, teeth) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    for (const [da, r] of [
      [-0.3, rIn],
      [-0.17, rOut],
      [0.17, rOut],
      [0.3, rIn],
    ]) {
      const ang = a + da * step * 1.15;
      pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`);
    }
  }
  return `M${pts.join(' L')}Z`;
}

// Four-point sparkle centred on (x, y).
function sparkle(x, y, r) {
  const k = r * 0.24;
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
}

// The Settings gear path, built once.
const GEAR = gear(12, 12, 10, 7.6, 8);
// Palm fronds drooping from the crown at (19.4, 12.4).
const PALM = [
  'M19.4 12.4Q16 11 15.3 15Q17 13 19.4 12.4Z',
  'M19.4 12.4Q17.6 9 15.7 10Q17.8 10.8 19.4 12.4Z',
  'M19.4 12.4Q18.8 9 21 8.3Q20.2 10.4 19.4 12.4Z',
  'M19.4 12.4Q21.4 8.8 23.4 10.6Q21.4 10.8 19.4 12.4Z',
  'M19.4 12.4Q23.2 11.2 23.6 15Q21.8 12.8 19.4 12.4Z',
];

// ---------- sidebar (duotone) ----------
// Dashboard: a house with a door.
export const IconDashboard = (p) => (
  <Svg {...p}>
    <path
      d="M3.4 10.4 12 3.3l8.6 7.1v8.4a2.2 2.2 0 0 1-2.2 2.2H5.6a2.2 2.2 0 0 1-2.2-2.2Z"
      fill={C.redSoft}
      stroke={C.red}
      strokeWidth="2.2"
    />
    <path d="M9.4 21v-4.8a2.6 2.6 0 0 1 5.2 0V21" fill="#fff" stroke={C.red} strokeWidth="2.2" />
  </Svg>
);

// My Space: an ID badge with a person.
export const IconMySpace = (p) => (
  <Svg {...p}>
    <rect
      x="3.6"
      y="3"
      width="16.8"
      height="18"
      rx="3"
      fill={C.indigoSoft}
      stroke={C.indigo}
      strokeWidth="2"
    />
    <path d="M10 6.2h4" stroke={C.indigo} strokeWidth="2" />
    <circle cx="12" cy="11" r="2.6" fill="#fff" stroke={C.indigo} strokeWidth="2" />
    <path d="M7.6 17.6a4.4 4.4 0 0 1 8.8 0" stroke={C.indigo} strokeWidth="2" />
  </Svg>
);

// Hiring: a person with a plus sign.
export const IconHiring = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="7.6" r="3.7" fill={C.blueSoft} stroke={C.blue} strokeWidth="2" />
    <path
      d="M2.6 20.2v-.7a6.4 6.4 0 0 1 12.8 0v.7Z"
      fill={C.blueSoft}
      stroke={C.blue}
      strokeWidth="2"
    />
    <path d="M19 6.8v6.4M15.8 10h6.4" stroke={C.blue} strokeWidth="2.3" />
  </Svg>
);

// Resume Screener AI: a magic wand with sparkles.
export const IconScreener = (p) => (
  <Svg {...p}>
    <path d="M3.4 20.6 12 12" stroke={C.violet} strokeWidth="3.8" />
    <g transform="rotate(45 12.4 11.6)">
      <rect x="6.9" y="8.8" width="11" height="5.6" rx="2.8" fill={C.violet} />
      <path d="M9.6 10.6h5.6" stroke={C.violetSoft} strokeWidth="1.6" />
    </g>
    <path d={sparkle(17.6, 4.2, 3)} fill={C.violet} />
    <path d={sparkle(21, 10.4, 2.4)} fill={C.violet} />
    <path d={sparkle(18.6, 17, 1.8)} fill={C.violet} />
  </Svg>
);

// Employees: a group of three people.
export const IconEmployees = (p) => (
  <Svg {...p}>
    <path
      d="M1.5 18.5v-.4a3.6 3.6 0 0 1 4.6-3.5"
      fill={C.skySoft}
      stroke={C.sky}
      strokeWidth="1.9"
    />
    <path
      d="M22.5 18.5v-.4a3.6 3.6 0 0 0-4.6-3.5"
      fill={C.skySoft}
      stroke={C.sky}
      strokeWidth="1.9"
    />
    <circle cx="4.9" cy="10.2" r="2.2" fill={C.sky} />
    <circle cx="19.1" cy="10.2" r="2.2" fill={C.sky} />
    <circle cx="12" cy="7.3" r="3.3" fill={C.blueSoft} stroke={C.blue} strokeWidth="2" />
    <path
      d="M6.6 20v-.9a5.4 5.4 0 0 1 10.8 0v.9Z"
      fill={C.blueSoft}
      stroke={C.blue}
      strokeWidth="2"
    />
  </Svg>
);

// Documents: an open folder holding a sheet.
export const IconDocuments = (p) => (
  <Svg {...p}>
    <path d="M3.4 12V6.3a1.7 1.7 0 0 1 1.7-1.7H8" stroke={C.orange} strokeWidth="2" />
    <path
      d="M7.2 12V4.4A1.6 1.6 0 0 1 8.8 2.8h5.4l3.4 3.4V12"
      fill={C.paper}
      stroke={C.orange}
      strokeWidth="1.8"
    />
    <path d="M14 2.9v3.4h3.4" stroke={C.orange} strokeWidth="1.8" />
    <path d="M9.8 7.6h3.6M9.8 10h5" stroke={C.paperLine} strokeWidth="1.7" />
    <path
      d="M2.6 11.6h18.8a.9.9 0 0 1 .9 1.1l-1.4 6.6a2 2 0 0 1-2 1.6H5.2a2 2 0 0 1-2-1.6l-1.5-6.6a.9.9 0 0 1 .9-1.1Z"
      fill={C.orangeSoft}
      stroke={C.orange}
      strokeWidth="2"
    />
  </Svg>
);

// Leave & Policies: a policy sheet with a ticked shield.
export const IconLeave = (p) => (
  <Svg {...p}>
    <rect
      x="3"
      y="2.8"
      width="13"
      height="17.6"
      rx="2.2"
      fill={C.greenSoft}
      stroke={C.green}
      strokeWidth="2"
    />
    <path d="M6.4 7.4h6.2M6.4 10.8h6.2M6.4 14.2h3.4" stroke={C.green} strokeWidth="1.9" />
    <path
      d="M17.4 10.6 22 12.3v3.2c0 3.1-2 5.2-4.6 6.3-2.6-1.1-4.6-3.2-4.6-6.3v-3.2Z"
      fill="#E4F8EE"
      stroke={C.green}
      strokeWidth="2"
    />
    <path d="m15.4 16 1.5 1.5 2.7-2.9" stroke={C.green} strokeWidth="1.9" />
  </Svg>
);

// Holiday Calendar: a calendar with a palm tree over its corner.
export const IconHolidays = (p) => (
  <Svg {...p}>
    <rect x="1.4" y="4" width="15.6" height="16.4" rx="3" fill={C.pinkSoft} />
    <path d="M1.4 7a3 3 0 0 1 3-3H14a3 3 0 0 1 3 3v1.8H1.4Z" fill={C.pinkMid} />
    <rect x="1.4" y="4" width="15.6" height="16.4" rx="3" stroke={C.pink} strokeWidth="2" />
    <path d="M5.6 2.2v3.4M12.8 2.2v3.4" stroke={C.pink} strokeWidth="2.2" />
    {[4.2, 8, 11.8].flatMap((x) =>
      [11.2, 15].map((y) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="2.4" height="2.4" rx=".7" fill={C.pink} />
      )),
    )}
    {/* The palm sits over the corner; a halo in the row's background colour keeps it clear of the frame. */}
    <g style={{ stroke: 'var(--icon-cut, #fff)' }} strokeWidth="2.6">
      <path d="M19.4 12.6Q19.8 17.2 18 21.2" />
      {PALM.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
    <path d="M19.4 12.6Q19.8 17.2 18 21.2" stroke={C.palm} strokeWidth="1.9" />
    {PALM.map((d) => (
      <path key={d} d={d} fill={C.palm} stroke={C.palm} strokeWidth=".5" />
    ))}
  </Svg>
);

// Payroll: a bank card with a rupee coin.
export const IconPayroll = (p) => (
  <Svg {...p}>
    <rect
      x="1.6"
      y="4"
      width="17.6"
      height="12.4"
      rx="2.4"
      fill={C.cardSoft}
      stroke={C.card}
      strokeWidth="2"
    />
    <path d="M1.6 7.4h17.6v2H1.6Z" fill={C.card} />
    <path d="M5 13h3.2" stroke={C.card} strokeWidth="2" />
    <circle cx="17.6" cy="16.8" r="5.4" fill={C.card} stroke="#fff" strokeWidth="1.6" />
    <path
      d="M15.3 14.3h4.6M15.3 16h4.6M16.2 14.3c2.3 0 2.3 3.4 0 3.4h-.9l3.2 2.9"
      stroke="#fff"
      strokeWidth="1.35"
    />
  </Svg>
);

// Performance: rising bars with a trend arrow.
export const IconPerformance = (p) => (
  <Svg {...p}>
    <rect x="2.6" y="14.6" width="4.4" height="6.6" rx="1.4" fill={C.violetBar} />
    <rect x="9.8" y="11" width="4.4" height="10.2" rx="1.4" fill={C.violetBar} />
    <rect x="17" y="7.6" width="4.4" height="13.6" rx="1.4" fill={C.violetBar} />
    <path d="M2.8 11c5.6-1 10.8-3.4 16-7.8" stroke={C.violet} strokeWidth="2" />
    <path d="M15.2 2.8h4.4v4.4" stroke={C.violet} strokeWidth="2" />
  </Svg>
);

// Attendance: a clock face.
export const IconAttendance = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9.2" fill={C.clockSoft} stroke={C.clock} strokeWidth="2.4" />
    <path d="M12 6.8V12l3.4 3" stroke={C.hands} strokeWidth="2.2" />
  </Svg>
);

// POSH: a shield with the female symbol.
export const IconPosh = (p) => (
  <Svg {...p}>
    <path
      d="M12 2.4 19.6 5.2V11c0 5-3.3 8.7-7.6 10.6C7.7 19.7 4.4 16 4.4 11V5.2Z"
      fill={C.magentaSoft}
      stroke={C.magenta}
      strokeWidth="2"
    />
    <circle cx="12" cy="9.8" r="3" fill="#FDEBF7" stroke={C.magenta} strokeWidth="2" />
    <path d="M12 12.8v5M9.8 15.5h4.4" stroke={C.magenta} strokeWidth="2" />
  </Svg>
);

// Resignation: a letter with an exit arrow.
export const IconResignation = (p) => (
  <Svg {...p}>
    <path
      d="M15.2 9.2V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.2a2 2 0 0 0 2-2v-4.2"
      fill={C.emberSoft}
      stroke={C.ember}
      strokeWidth="2"
    />
    <path d="M6.3 7.4h5.6M6.3 10.4h3.6M6.3 16.6h5" stroke={C.ember} strokeWidth="1.9" />
    <path d="M10.8 13.4h10.6M18.2 10.2l3.2 3.2-3.2 3.2" stroke={C.ember} strokeWidth="2.1" />
  </Svg>
);

// Reports: three rising green bars.
export const IconReports = (p) => (
  <Svg {...p}>
    <rect x="3" y="13" width="4.6" height="8.4" rx="1.6" fill={C.mint1} />
    <rect x="9.7" y="8.4" width="4.6" height="13" rx="1.6" fill={C.mint2} />
    <rect x="16.4" y="2.6" width="4.6" height="18.8" rx="1.6" fill={C.mint3} />
  </Svg>
);

// Settings: a gear.
export const IconSettings = (p) => (
  <Svg {...p}>
    <path d={GEAR} fill={C.slateSoft} stroke={C.slate} strokeWidth="1.9" />
    <circle cx="12" cy="12" r="3.2" fill="#fff" stroke={C.slate} strokeWidth="1.9" />
  </Svg>
);

// ---------- top bar (navy outline with brand accents) ----------
// Stroke shared by the navy outline icons.
const line = { stroke: C.navy, strokeWidth: 1.9 };

// Magnifying glass.
export const IconSearch = (p) => (
  <Svg {...p}>
    <circle cx="10.6" cy="10.6" r="6.6" {...line} />
    <path d="m15.6 15.6 4.8 4.8" {...line} />
  </Svg>
);

// Stopwatch for the work clock; `color` overrides the navy.
export const IconTimer = ({ color = C.navy, ...p }) => (
  <Svg {...p}>
    <circle cx="12" cy="13.4" r="7.4" stroke={color} strokeWidth="1.9" />
    <path
      d="M9.6 2.8h4.8M12 2.8V6M18.3 7.2l1.3-1.3M5.7 7.2 4.4 5.9M12 9.6v4l2.6 1.8"
      stroke={color}
      strokeWidth="1.9"
    />
  </Svg>
);

// Green "working" status dot; `pulse` animates its halo.
export const IconWorking = ({ pulse, ...p }) => (
  <Svg {...p}>
    <circle
      cx="12"
      cy="12"
      r="10"
      fill={C.statusHalo}
      className={pulse ? 'status-halo' : undefined}
    />
    <circle cx="12" cy="12" r="5.6" fill={C.statusGreen} />
  </Svg>
);

// Notification bell.
export const IconBell = (p) => (
  <Svg {...p}>
    <path d="M6 16.6V11a6 6 0 0 1 12 0v5.6l1.6 1.9H4.4Z" {...line} />
    <path d="M10 20.6a2 2 0 0 0 4 0M12 3.4V5" {...line} />
  </Svg>
);

// Account avatar: a person on a peach circle.
export const IconProfile = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="12" fill={C.peach} />
    <circle cx="12" cy="9.4" r="3.3" stroke={C.navy} strokeWidth="1.6" />
    <path
      d="M6.6 18.4a5.4 5.4 0 0 1 10.8 0v.3a.7.7 0 0 1-.7.7H7.3a.7.7 0 0 1-.7-.7Z"
      stroke={C.navy}
      strokeWidth="1.6"
    />
  </Svg>
);

// Down chevron for menus.
export const IconChevronDown = (p) => (
  <Svg {...p}>
    <path d="m6 9.4 6 6 6-6" {...line} />
  </Svg>
);

// Live vertical: a screen with a red play button.
export const IconLive = (p) => (
  <Svg {...p}>
    <rect x="2.4" y="3.8" width="19.2" height="13.4" rx="2" {...line} />
    <path d="M12 17.2v3.4M8 20.6h8" {...line} />
    <path d="M10 7.6v6.2l5-3.1Z" stroke={C.live} strokeWidth="1.9" />
  </Svg>
);

// Marketing vertical: a megaphone.
export const IconMarketing = (p) => (
  <Svg {...p}>
    <path
      d="M4.2 9.2h3.4l8-4.6v14.8l-8-4.6H4.2a1.6 1.6 0 0 1-1.6-1.6v-2.4a1.6 1.6 0 0 1 1.6-1.6Z"
      {...line}
    />
    <path d="m7.6 14.8 1.2 4.9a1 1 0 0 1-1 1.3h-.6a1 1 0 0 1-1-.8l-1.1-5.4" {...line} />
    <path d="m18.6 6.4 1.8-1.6M19.2 10.4h2.6M18.6 14.4l1.8 1.6" stroke={C.live} strokeWidth="1.9" />
  </Svg>
);

// Exhibits vertical: four tiles, one in green.
export const IconExhibits = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.6" height="7.6" rx="2" {...line} />
    <rect x="13.4" y="3" width="7.6" height="7.6" rx="2" stroke={C.exhibits} strokeWidth="1.9" />
    <rect x="3" y="13.4" width="7.6" height="7.6" rx="2" {...line} />
    <rect x="13.4" y="13.4" width="7.6" height="7.6" rx="2" {...line} />
  </Svg>
);

// Icon for each business vertical, by vertical name.
export const VERTICAL_ICONS = { Live: IconLive, Marketing: IconMarketing, Exhibits: IconExhibits };

// The "Br" monogram: the collapsed sidebar and general messages (traced from the brand artwork).
const MONOGRAM_PATH =
  'M31.7 0.0L26.3 0.4L22.7 1.1L19.1 2.2L17.4 2.9L14.9 4.2L11.9 6.3L9.9 8.2L8.6 9.6L7.4 11.3L6.3 13.0L4.9 16.2L4.2 18.5L3.6 20.8L3.1 25.6L3.3 30.1L3.6 32.2L4.2 34.2L4.8 35.6L6.1 38.1L8.4 41.1L10.1 42.8L11.8 44.1L13.2 44.9L15.2 45.8L15.2 45.9L13.5 46.6L10.1 48.4L7.7 50.1L6.0 51.7L4.3 53.9L3.5 55.3L2.0 58.3L1.4 60.1L0.5 63.5L0.2 66.3L0.0 68.9L0.1 72.4L0.4 75.9L1.1 79.0L2.0 81.7L3.2 84.4L4.7 86.9L6.3 89.0L9.2 91.9L12.0 94.1L15.5 95.9L17.7 96.9L21.3 98.1L23.9 98.7L26.5 99.2L30.2 99.6L34.9 99.9L82.2 100.0L82.3 55.8L82.8 54.0L83.4 52.3L84.1 50.9L85.8 48.6L87.6 46.9L88.9 46.0L90.3 45.3L92.3 44.6L93.9 44.1L97.2 43.7L101.3 43.6L105.2 44.1L105.2 23.9L99.8 23.9L97.7 24.1L94.4 24.6L92.2 25.2L89.1 26.6L86.7 28.1L85.1 29.4L83.5 30.9L82.7 32.0L82.4 32.2L82.4 0.1ZM62.3 22.4L62.2 39.0L34.9 39.0L32.0 38.7L30.6 38.4L29.0 37.9L27.6 37.2L26.2 36.1L25.4 35.2L24.5 34.0L23.9 32.6L23.6 31.4L23.3 29.4L23.3 26.4L23.8 23.9L24.6 22.1L25.5 20.8L26.7 19.7L28.6 18.6L30.8 17.9L32.9 17.5L35.2 17.3L62.3 17.4ZM20.4 69.3L20.3 68.0L20.6 65.3L21.2 63.1L22.1 61.3L23.0 60.1L24.6 58.7L25.6 58.1L28.0 57.0L30.3 56.4L33.9 56.0L62.2 56.0L62.2 83.0L33.8 82.9L31.9 82.6L29.9 82.2L28.1 81.5L25.8 80.1L24.5 79.1L23.0 77.4L21.9 75.6L21.0 73.4L20.5 71.5Z';
// Draws the monogram at any height and colour.
// label={null} when something around it already names it (a button, a heading).
export function Monogram({ className = '', height = 36, color = '#2B3C6D', label = 'BrainADZ' }) {
  return (
    <svg
      className={className}
      height={height}
      viewBox="0 0 105.2 100"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path fill={color} fillRule="evenodd" d={MONOGRAM_PATH} />
    </svg>
  );
}

// Each portal section's look, taken from its sidebar icon: color for accents, soft for tiles,
// ink for small text (at least 4.5:1 on white).
export const MODULES = [
  {
    path: '/my',
    label: 'My Space',
    Icon: IconMySpace,
    color: C.indigo,
    soft: C.indigoSoft,
    ink: '#3346B8',
  },
  {
    path: '/hiring',
    label: 'Hiring',
    Icon: IconHiring,
    color: C.blue,
    soft: C.blueSoft,
    ink: '#0A55C8',
  },
  {
    path: '/screener',
    label: 'Resume Screener AI',
    Icon: IconScreener,
    color: C.violet,
    soft: C.violetSoft,
    ink: '#5532E0',
  },
  {
    path: '/employees',
    label: 'Employees',
    Icon: IconEmployees,
    color: C.sky,
    soft: C.skySoft,
    ink: '#0A72A3',
  },
  {
    path: '/documents',
    label: 'Documents',
    Icon: IconDocuments,
    color: C.orange,
    soft: C.orangeSoft,
    ink: '#A85600',
  },
  {
    path: '/leave',
    label: 'Leave & Policies',
    Icon: IconLeave,
    color: C.green,
    soft: C.greenSoft,
    ink: '#007A47',
  },
  {
    path: '/calendar',
    label: 'Holiday Calendar',
    Icon: IconHolidays,
    color: C.pink,
    soft: C.pinkSoft,
    ink: '#C8174F',
  },
  {
    path: '/payroll',
    label: 'Payroll',
    Icon: IconPayroll,
    color: C.card,
    soft: C.cardSoft,
    ink: '#1460D0',
  },
  {
    path: '/performance',
    label: 'Performance',
    Icon: IconPerformance,
    color: C.violetBar,
    soft: C.violetSoft,
    ink: '#6A3FD6',
  },
  {
    path: '/attendance',
    label: 'Attendance',
    Icon: IconAttendance,
    color: C.clock,
    soft: C.clockSoft,
    ink: '#0B62D0',
  },
  {
    path: '/posh',
    label: 'POSH',
    Icon: IconPosh,
    color: C.magenta,
    soft: C.magentaSoft,
    ink: '#B4127F',
  },
  {
    path: '/resignation',
    label: 'Resignation',
    Icon: IconResignation,
    color: C.ember,
    soft: C.emberSoft,
    ink: '#C2380E',
  },
  {
    path: '/reports',
    label: 'Reports',
    Icon: IconReports,
    color: C.mint3,
    soft: '#D4F3E8',
    ink: '#007A57',
  },
  {
    path: '/settings',
    label: 'Settings',
    Icon: IconSettings,
    color: C.slate,
    soft: C.slateSoft,
    ink: '#4A627A',
  },
  {
    path: '/account',
    label: 'My account',
    Icon: IconProfile,
    color: C.navy,
    soft: C.peach,
    ink: C.navy,
  },
  {
    path: '/',
    label: 'Dashboard',
    Icon: IconDashboard,
    color: C.red,
    soft: C.redSoft,
    ink: '#D0102F',
  },
];
// Theme for pages outside any module: the Br monogram in navy.
const GENERAL = {
  path: '',
  label: 'BrainADZ HRMS',
  Icon: (p) => <Monogram height={(p.size || 24) * 0.82} />,
  color: C.navy,
  soft: '#E4E9F4',
  ink: C.navy,
};

// The section a path belongs to: '/employees/12' is Employees, '/' only matches the dashboard itself.
export function moduleFor(path = '') {
  return (
    MODULES.find((m) =>
      m.path === '/' ? path === '/' : path === m.path || path.startsWith(`${m.path}/`),
    ) || GENERAL
  );
}
