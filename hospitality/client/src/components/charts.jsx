// SVG charts: line (crosshair tooltip), donut (legend with values), columns and horizontal bars
// (per-mark tooltips), sparkline and heat cells. Marks: 2px lines, ≥8px markers, bars ≤24px with
// 4px rounded data ends, hairline solid grid, text in text colours (never the series colour).
import { useEffect, useMemo, useRef, useState } from 'react';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// "Nice" axis ticks from 0 to above max.
function ticks(max, count = 4) {
  if (!max || max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function Tooltip({ x, y, width, children }) {
  const left = Math.min(Math.max(8, x + 12), width - 190);
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top: Math.max(0, y - 10),
        pointerEvents: 'none',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 12,
        minWidth: 150,
        zIndex: 5,
      }}
    >
      {children}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="row wrap" style={{ gap: 14, fontSize: 12, color: 'var(--text-2)', marginTop: 8 }}>
      {items.map((it) => (
        <span key={it.label} className="row" style={{ gap: 6 }}>
          {it.line ? <span className="linekey" style={{ background: it.color }} /> : <span className="swatch" style={{ background: it.color }} />}
          {it.label}
          {it.value != null && <b className="num" style={{ color: 'var(--text)' }}>{it.value}</b>}
        </span>
      ))}
    </div>
  );
}

// series: [{ key, label, color, values: number[], muted?, area? }], labels: string[]
// labels[i] names slot i; a null value is a gap (no records), drawn as a break, never as zero.
// notes[i] (optional) qualifies a slot in the tooltip, e.g. "month to date".
export function LineChart({ labels, series, notes = [], height = 240, format = (v) => v, axisFormat = format, legend = true }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 52, r: 16, t: 12, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null)));
  const tk = ticks(max);
  const top = tk[tk.length - 1];
  const x = (i) => pad.l + (labels.length <= 1 ? w / 2 : (i * w) / (labels.length - 1));
  const y = (v) => pad.t + h - (v / top) * h;
  // Contiguous runs of non-null values; each run is its own line (and area) segment.
  const runs = (vals) => {
    const out = [];
    let cur = null;
    vals.forEach((v, i) => {
      if (v == null) return void (cur = null);
      if (!cur) out.push((cur = []));
      cur.push(i);
    });
    return out;
  };
  const path = (vals) =>
    runs(vals)
      .map((run) => run.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(''))
      .join('');
  const area = (vals) =>
    runs(vals)
      .map((run) => `${run.map((i, j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join('')}L${x(run[run.length - 1])},${y(0)}L${x(run[0])},${y(0)}Z`)
      .join('');
  const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(w / 70))));
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    const i = Math.round((px / w) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {tk.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % step === 0 || i === labels.length - 1 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) =>
          s.area ? <path key={`${s.key}-a`} d={area(s.values)} fill={s.color} opacity="0.1" /> : null,
        )}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series
          .filter((s) => !s.muted)
          .map((s) => {
            const i = s.values.length - 1;
            return s.values[i] != null ? <circle key={`${s.key}-end`} cx={x(i)} cy={y(s.values[i])} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" /> : null;
          })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--border-strong)" strokeWidth="1" />
            {series.map((s) =>
              s.values[hover] != null ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="var(--surface)" strokeWidth="2" /> : null,
            )}
          </g>
        )}
      </svg>
      {hover != null && (
        <Tooltip x={x(hover)} y={pad.t} width={width}>
          <div className="muted" style={{ marginBottom: 4 }}>
            {labels[hover]}
            {notes[hover] ? ` · ${notes[hover]}` : ''}
          </div>
          {series.map((s) => (
            <div key={s.key} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 6, color: 'var(--text-2)' }}>
                <span className="linekey" style={{ background: s.color }} />
                {s.label}
              </span>
              <b className="num">{s.values[hover] == null ? 'no records' : format(s.values[hover])}</b>
            </div>
          ))}
        </Tooltip>
      )}
      {legend && series.length > 1 && <Legend items={series.map((s) => ({ label: s.label, color: s.color, line: true }))} />}
    </div>
  );
}

// data: [{ label, value, color }]
export function Donut({ data, size = 180, thickness = 26, center, sub, format = (v) => v }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((a, d) => a + Math.max(0, d.value || 0), 0);
  const r = size / 2 - 2;
  const ri = r - thickness;
  let a0 = -Math.PI / 2;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 0.012 : 0;
  const arcs = data.map((d) => {
    const frac = total ? Math.max(0, d.value) / total : 0;
    const a1 = a0 + frac * Math.PI * 2;
    const s = a0 + gap;
    const e = Math.max(s, a1 - gap);
    a0 = a1;
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${size / 2 + rad * Math.cos(ang)},${size / 2 + rad * Math.sin(ang)}`;
    return { ...d, frac, d: frac > 0.0005 ? `M${p(r, s)}A${r},${r} 0 ${large} 1 ${p(r, e)}L${p(ri, e)}A${ri},${ri} 0 ${large} 0 ${p(ri, s)}Z` : null };
  });
  return (
    <div className="row" style={{ gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label="Share by category">
          {arcs.map((a, i) =>
            a.d ? (
              <path key={a.label} d={a.d} fill={a.color} opacity={hover == null || hover === i ? 1 : 0.45} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <title>{`${a.label}: ${format(a.value)} (${(a.frac * 100).toFixed(1)}%)`}</title>
              </path>
            ) : null,
          )}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }} className="num">
              {hover != null ? format(arcs[hover].value) : center}
            </div>
            <div className="small muted">{hover != null ? arcs[hover].label : sub}</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 180 }}>
        {arcs.map((a, i) => (
          <div key={a.label} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', gap: 10 }} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="swatch" style={{ background: a.color }} />
            <span style={{ flex: 1, color: 'var(--text-2)' }}>{a.label}</span>
            <span className="num muted small">{(a.frac * 100).toFixed(1)}%</span>
            <b className="num" style={{ minWidth: 80, textAlign: 'right' }}>
              {format(a.value)}
            </b>
          </div>
        ))}
      </div>
    </div>
  );
}

// Vertical columns. bars: [{ label, value, color? }]
export function Columns({ bars, height = 200, format = (v) => v, axisFormat = format, color = 'var(--series-1)', highlight }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 48, r: 8, t: 10, b: 26 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(1, ...bars.map((b) => b.value || 0));
  const tk = ticks(max);
  const top = tk[tk.length - 1];
  const band = w / Math.max(1, bars.length);
  const bw = Math.min(24, band * 0.62);
  const y = (v) => pad.t + h - (Math.max(0, v) / top) * h;
  const step = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(w / 46))));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label="Column chart">
        {tk.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = pad.l + band * i + band / 2;
          const top0 = y(b.value || 0);
          const bh = pad.t + h - top0;
          const r = Math.min(4, bh);
          const x0 = cx - bw / 2;
          const d = bh > 0 ? `M${x0},${pad.t + h}V${top0 + r}Q${x0},${top0} ${x0 + r},${top0}H${x0 + bw - r}Q${x0 + bw},${top0} ${x0 + bw},${top0 + r}V${pad.t + h}Z` : '';
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={pad.l + band * i} y={pad.t} width={band} height={h} fill="transparent" />
              {d && <path d={d} fill={b.color || (highlight != null && highlight !== i ? 'var(--series-muted)' : color)} opacity={hover == null || hover === i ? 1 : 0.6} />}
              {(i % step === 0 || i === bars.length - 1) && (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip x={pad.l + band * hover + band / 2} y={y(bars[hover].value || 0) - 30} width={width}>
          <div className="muted">{bars[hover].label}</div>
          <b className="num">{format(bars[hover].value)}</b>
          {bars[hover].note && <div className="small muted">{bars[hover].note}</div>}
        </Tooltip>
      )}
    </div>
  );
}

// Horizontal bars with values at the tip. bars: [{ label, value, sub? }]
export function HBars({ bars, format = (v) => v, color = 'var(--series-1)', max: maxIn }) {
  const max = maxIn || Math.max(1, ...bars.map((b) => b.value || 0));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {bars.map((b) => (
        <div key={b.label} title={`${b.label}: ${format(b.value)}`}>
          <div className="row small" style={{ marginBottom: 4 }}>
            <span style={{ color: 'var(--text-2)' }}>{b.label}</span>
            {b.sub && <span className="faint">{b.sub}</span>}
            <span className="spacer" />
            <b className="num" style={{ color: 'var(--text)' }}>
              {format(b.value)}
            </b>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-3)' }}>
            <div style={{ width: `${Math.max(0, Math.min(100, ((b.value || 0) / max) * 100))}%`, height: 8, borderRadius: 4, background: b.color || color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 90, height = 26, color = 'var(--series-1)' }) {
  const pts = useMemo(() => {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return '';
    const max = Math.max(...v);
    const min = Math.min(...v);
    return values.map((x, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((x - min) / (max - min || 1)) * (height - 6)}`).join(' ');
  }, [values, width, height]);
  return (
    <svg width={width} height={height} aria-hidden>
      {pts && <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

// Sequential blue ramp for heat cells (0–1).
const RAMP = ['#eef4fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];
export const heat = (t) => (t == null ? 'var(--surface-3)' : RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))]);
export const heatText = (t) => (t != null && t > 0.6 ? '#fff' : 'var(--text)');
