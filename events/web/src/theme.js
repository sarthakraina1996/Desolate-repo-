// The look of the visitor app and the ticket, as designed per exhibition in the organiser's
// Design studio. Turns a saved design into CSS variables; the stylesheet does the rest.

// Ready-made looks an organiser can start from. Each sets the app theme and a matching ticket.
export const PRESETS = [
  {
    key: 'brainadz',
    name: 'BrainADZ Live',
    primary: '#233e85',
    accent: '#c82026',
    canvas: '#f9f7f4',
    pattern: 'network',
    corners: 'soft',
    font: 'jost',
    tabs: 'light',
  },
  {
    key: 'tech',
    name: 'Tech summit',
    primary: '#0b1f3a',
    accent: '#00b3a4',
    canvas: '#f2f6f8',
    pattern: 'grid',
    corners: 'soft',
    font: 'grotesk',
    tabs: 'solid',
  },
  {
    key: 'festival',
    name: 'Festival',
    primary: '#5b21b6',
    accent: '#f43f5e',
    canvas: '#faf5ff',
    pattern: 'confetti',
    corners: 'round',
    font: 'poppins',
    tabs: 'solid',
  },
  {
    key: 'auto',
    name: 'Auto show',
    primary: '#111827',
    accent: '#f97316',
    canvas: '#f3f4f6',
    pattern: 'rays',
    corners: 'square',
    font: 'grotesk',
    tabs: 'solid',
  },
  {
    key: 'lifestyle',
    name: 'Wedding & lifestyle',
    primary: '#7a2e4d',
    accent: '#b8862f',
    canvas: '#fbf6f1',
    pattern: 'waves',
    corners: 'round',
    font: 'elegant',
    tabs: 'light',
  },
  {
    key: 'food',
    name: 'Food & drink',
    primary: '#14532d',
    accent: '#ea580c',
    canvas: '#f7f7f0',
    pattern: 'dots',
    corners: 'round',
    font: 'poppins',
    tabs: 'light',
  },
  {
    key: 'gaming',
    name: 'Gaming & comics',
    primary: '#1e1b4b',
    accent: '#d946ef',
    canvas: '#f3f2fb',
    pattern: 'rays',
    corners: 'soft',
    font: 'grotesk',
    tabs: 'solid',
  },
  {
    key: 'education',
    name: 'Education fair',
    primary: '#075985',
    accent: '#facc15',
    canvas: '#f3f8fb',
    pattern: 'dots',
    corners: 'soft',
    font: 'poppins',
    tabs: 'light',
  },
];
export const PATTERNS = [
  ['network', 'Network'],
  ['dots', 'Dots'],
  ['waves', 'Waves'],
  ['confetti', 'Confetti'],
  ['rays', 'Rays'],
  ['grid', 'Grid'],
  ['none', 'Plain'],
];
export const FONTS = [
  ['jost', 'Jost (clean)'],
  ['poppins', 'Poppins (friendly)'],
  ['grotesk', 'Space Grotesk (tech)'],
  ['elegant', 'Playfair headings (elegant)'],
];
export const CORNERS = [
  ['soft', 'Soft'],
  ['round', 'Round'],
  ['square', 'Square'],
];

const FALLBACK = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const BODY = { jost: "'Jost'", poppins: "'Poppins'", grotesk: "'Space Grotesk'", elegant: "'Jost'" };
const HEAD = { ...BODY, elegant: "'Playfair Display', Georgia, serif" };
const RADIUS = { soft: ['14px', '8px'], round: ['24px', '999px'], square: ['4px', '4px'] };

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) =>
  `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
// Mixes a colour with white (amount > 0) or black (amount < 0).
export const shade = (hex, amount) => toHex(rgb(hex).map((v) => (amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
// Black or white, whichever reads better on the colour.
export function onColour(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#1b1b1f' : '#ffffff';
}

// CSS variables for the visitor app.
export function themeVars(t) {
  if (!t) return undefined;
  const [card, button] = RADIUS[t.corners] || RADIUS.soft;
  const light = onColour(t.accent) !== '#ffffff';
  return {
    '--navy': t.primary,
    '--on-primary': onColour(t.primary),
    '--accent': t.accent,
    '--accent-hover': shade(t.accent, -0.16),
    '--on-accent': onColour(t.accent),
    // Text in the accent colour must stay readable on white: darken light accents.
    '--accent-text': light ? shade(t.accent, -0.45) : t.accent,
    '--selected': shade(t.accent, 0.88),
    '--canvas': t.canvas,
    '--r-card': card,
    '--r-btn': button,
    '--font': `${BODY[t.font] || BODY.jost}, ${FALLBACK}`,
    '--font-head': `${HEAD[t.font] || HEAD.jost}, ${FALLBACK}`,
  };
}
// CSS variables for a ticket.
export function ticketVars(k) {
  if (!k) return undefined;
  const [card] = RADIUS[k.corners] || RADIUS.soft;
  return {
    '--t-band': k.band,
    '--t-band-text': k.bandText,
    '--t-accent': k.accent,
    '--t-on-accent': onColour(k.accent),
    '--t-paper': k.paper,
    '--t-ink': k.ink,
    '--t-ink2': onColour(k.paper) === '#ffffff' ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.58)',
    '--t-rule': onColour(k.paper) === '#ffffff' ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.16)',
    '--t-radius': card === '14px' ? '18px' : card,
  };
}
// A ticket design that matches an app theme, used by presets.
export const ticketFromTheme = (t, ticket) => ({
  ...ticket,
  band: t.primary,
  bandText: onColour(t.primary),
  accent: t.accent,
  paper: '#ffffff',
  ink: '#231f20',
  pattern: t.pattern,
  corners: t.corners,
});
