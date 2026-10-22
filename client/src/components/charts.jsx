// Hand-rolled SVG charts. Palettes were checked with the dataviz validator:
// CAT (categorical order), vertical brand colours, and status colours.
import { useEffect, useMemo, useRef, useState } from 'react';

// Tracks an element's rendered width so SVG text stays at real pixel size.
function useWidth(fallback = 560) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
import { Check } from 'lucide-react';

export const CAT = ['#1A6DF0', '#E8890C', '#7C5CFC', '#0F9D8F', '#E5243B'];
export const STATUS = {
  good: '#1FA855',
  warn: '#F2A600',
  bad: '#E5243B',
  neutral: '#B8C1CF',
  info: '#1A6DF0',
};
const GRID = '#EEF2F7';
const AXIS = '#6B7A90';

function useTip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content, w: box.width });
  };
  const el = tip ? (
    <div
      style={{
        position: 'absolute',
        left: Math.min(tip.x + 12, tip.w - 170),
        top: tip.y + 12,
        background: '#1b2848',
        color: '#fff',
        padding: '8px 10px',
        borderRadius: 8,
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 5,
        minWidth: 120,
        boxShadow: '0 6px 20px rgba(0,0,0,.18)',
        lineHeight: 1.5,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { ref, show, hide: () => setTip(null), el };
}

const fmtAxis = (v) =>
  v >= 1e7
    ? `${(v / 1e7).toFixed(1)}Cr`
    : v >= 1e5
      ? `${Math.round(v / 1e5)}L`
      : v >= 1000
        ? `${Math.round(v / 1000)}K`
        : String(Math.round(v * 10) / 10);
function niceMax(v) {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function Donut({ data, size = 170, thickness = 24, center, format = (v) => v }) {
  const t = useTip();
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div ref={t.ref} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={data.map((d) => `${d.label} ${d.value}`).join(', ')}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#EEF2F7"
          strokeWidth={thickness}
        />
        {total > 0 &&
          data.map((d) => {
            const len = (d.value / total) * c;
            const gap = data.filter((x) => x.value > 0).length > 1 ? Math.min(3, len / 2) : 0;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c - Math.max(0, len - gap)}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ cursor: 'default' }}
                onMouseMove={(e) =>
                  t.show(
                    e,
                    <>
                      <b>{d.label}</b>
                      <br />
                      {format(d.value)} · {Math.round((d.value / total) * 100)}%
                    </>,
                  )
                }
                onMouseLeave={t.hide}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      {center && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: size > 140 ? 26 : 18, fontWeight: 700 }}>{center.value}</div>
          {center.label && (
            <div
              style={{
                fontSize: 12,
                color: AXIS,
                textAlign: 'center',
                maxWidth: size - thickness * 2 - 10,
              }}
            >
              {center.label}
            </div>
          )}
        </div>
      )}
      {t.el}
    </div>
  );
}

export function Legend({ items, format = (v) => v, total, column = true }) {
  const sum = total ?? items.reduce((s, d) => s + (d.value || 0), 0);
  return (
    <div className={column ? 'legend' : 'row wrap gap-16'} style={{ flex: 1, minWidth: 0 }}>
      {items.map((d) => (
        <div key={d.label} className="li">
          <span className="dot" style={{ background: d.color, width: 12, height: 12 }} />
          <span className="ellipsis">{d.label}</span>
          {d.value != null && (
            <span className="v">
              {format(d.value)}
              {sum > 0 && d.showPct !== false && (
                <small> ({Math.round((d.value / sum) * 100)}%)</small>
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function Ring({ value = 0, size = 96, thickness = 9, color = STATUS.good, label, sub }) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="ring-label">
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        <svg width={size} height={size} role="img" aria-label={`${label || ''} ${v}%`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#EEF2F7"
            strokeWidth={thickness}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: size > 80 ? 20 : 15,
          }}
        >
          {Math.round(v)}%
        </div>
      </div>
      {label && (
        <div className="small" style={{ marginTop: 8, color: 'var(--text-2)', lineHeight: 1.3 }}>
          {label}
        </div>
      )}
      {sub && (
        <div className="b6 small" style={{ marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// Grouped vertical bars on one y-axis.
export function Bars({ categories, series, height = 190, format = fmtAxis, tipFormat }) {
  const t = useTip();
  const [wref, w] = useWidth();
  const pad = { l: 40, r: 8, t: 10, b: 26 };
  const all = series.flatMap((s) => s.values.map((v) => v || 0));
  const max = niceMax(Math.max(all.every(Number.isInteger) ? 4 : 1, ...all));
  const ih = height - pad.t - pad.b;
  const iw = w - pad.l - pad.r;
  const band = iw / Math.max(1, categories.length);
  const bw = Math.min(22, (band * 0.7) / series.length);
  const groupW = bw * series.length + 2 * (series.length - 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const y = (v) => pad.t + ih - (v / max) * ih;
  return (
    <div ref={t.ref} style={{ position: 'relative' }}>
      <div ref={wref} />
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Bar chart"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
              {format(v)}
            </text>
          </g>
        ))}
        {categories.map((cat, i) => {
          const x0 = pad.l + band * i + (band - groupW) / 2;
          return (
            <g
              key={cat}
              onMouseMove={(e) =>
                t.show(
                  e,
                  <>
                    <b>{cat}</b>
                    {series.map((s) => (
                      <div key={s.name}>
                        <span className="dot" style={{ background: s.color, marginRight: 6 }} />
                        {s.name}: {(tipFormat || format)(s.values[i])}
                      </div>
                    ))}
                  </>,
                )
              }
              onMouseLeave={t.hide}
            >
              <rect x={pad.l + band * i} y={pad.t} width={band} height={ih} fill="transparent" />
              {series.map((s, k) => {
                const v = s.values[i] || 0;
                const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
                const x = x0 + k * (bw + 2);
                const rr = Math.min(4, bw / 2, h);
                return (
                  <path
                    key={s.name}
                    d={`M${x},${pad.t + ih} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${bw - 2 * rr} q${rr},0 ${rr},${rr} v${h - rr} z`}
                    fill={s.color}
                  />
                );
              })}
              <text
                x={pad.l + band * i + band / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize="11.5"
                fill={AXIS}
              >
                {cat}
              </text>
            </g>
          );
        })}
      </svg>
      {t.el}
    </div>
  );
}

export function LineChart({
  categories,
  series,
  height = 170,
  format = fmtAxis,
  tipFormat,
  min = 0,
}) {
  const t = useTip();
  const [hover, setHover] = useState(null);
  const [wref, w] = useWidth();
  const pad = { l: 40, r: 14, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null))));
  const ih = height - pad.t - pad.b;
  const iw = w - pad.l - pad.r;
  const x = (i) => pad.l + (categories.length === 1 ? iw / 2 : (iw * i) / (categories.length - 1));
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  return (
    <div ref={t.ref} style={{ position: 'relative' }}>
      <div ref={wref} />
      <svg
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Line chart"
        onMouseLeave={() => {
          setHover(null);
          t.hide();
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS}>
              {format(v)}
            </text>
          </g>
        ))}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#C9D2DF" />
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
          if (!pts.length) return null;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
          return (
            <g key={s.name}>
              {series.length === 1 && (
                <path
                  d={`${d} L${pts[pts.length - 1][0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z`}
                  fill={s.color}
                  opacity="0.1"
                />
              )}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map(
                (v, i) =>
                  v != null &&
                  (hover === i || i === s.values.length - 1) && (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r="4.5"
                      fill={s.color}
                      stroke="#fff"
                      strokeWidth="2"
                    />
                  ),
              )}
            </g>
          );
        })}
        {categories.map((cat, i) => (
          <g key={cat}>
            <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="11.5" fill={AXIS}>
              {cat}
            </text>
            <rect
              x={x(i) - iw / categories.length / 2}
              y={pad.t}
              width={iw / categories.length}
              height={ih}
              fill="transparent"
              onMouseMove={(e) => {
                setHover(i);
                t.show(
                  e,
                  <>
                    <b>{cat}</b>
                    {series.map((s) => (
                      <div key={s.name}>
                        <span className="dot" style={{ background: s.color, marginRight: 6 }} />
                        {s.name}: {(tipFormat || format)(s.values[i])}
                      </div>
                    ))}
                  </>,
                );
              }}
            />
          </g>
        ))}
      </svg>
      {t.el}
    </div>
  );
}

export function HBars({
  items,
  color = '#1A6DF0',
  format = (v) => v,
  max: maxIn,
  labelWidth = 110,
}) {
  const max = maxIn || Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="col" style={{ gap: 9 }}>
      {items.map((it) => (
        <div
          key={it.label}
          className="row"
          style={{ gap: 10 }}
          title={`${it.label}: ${format(it.value)}`}
        >
          <span
            className="small ellipsis"
            style={{ width: labelWidth, flexShrink: 0, color: 'var(--text-2)' }}
          >
            {it.label}
          </span>
          <div className="grow">
            <div className="progress" style={{ height: 9, background: 'transparent' }}>
              <i
                style={{
                  width: `${(it.value / max) * 100}%`,
                  background: it.color || color,
                  minWidth: it.value ? 4 : 0,
                }}
              />
            </div>
          </div>
          <span className="small b6 num" style={{ width: 54 }}>
            {format(it.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

const FUNNEL = ['#1350B8', '#1A6DF0', '#4C8DF5', '#82B0F8', '#B6D0FB'];
export function Funnel({ steps }) {
  const w = 200;
  const h = 34;
  const top = Math.max(1, steps[0]?.value || 1);
  return (
    <div className="row" style={{ gap: 18, alignItems: 'stretch' }}>
      <svg
        viewBox={`0 0 ${w} ${steps.length * (h + 3)}`}
        style={{ width: 'min(46%, 210px)', flexShrink: 0 }}
        role="img"
        aria-label="Funnel"
      >
        {steps.map((s, i) => {
          const w1 = Math.max(0.18, i === 0 ? 1 : steps[i].value / top) * w;
          const next = steps[i + 1] ? Math.max(0.18, steps[i + 1].value / top) * w : w1 * 0.8;
          const y0 = i * (h + 3);
          const x1 = (w - w1) / 2;
          const x2 = (w - next) / 2;
          return (
            <path
              key={s.label}
              d={`M${x1},${y0} L${w - x1},${y0} L${w - x2},${y0 + h} L${x2},${y0 + h} Z`}
              fill={FUNNEL[i % FUNNEL.length]}
            >
              <title>{`${s.label}: ${s.value}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="col grow" style={{ justifyContent: 'space-around', gap: 0 }}>
        {steps.map((s, i) => (
          <div key={s.label} className="row between small">
            <span className="row gap-6">
              <span className="dot" style={{ background: FUNNEL[i % FUNNEL.length] }} />
              {s.label}
            </span>
            <b style={{ fontSize: 14 }}>{Number(s.value || 0).toLocaleString('en-IN')}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// Workflow stepper; states: done | current | todo
export function Steps({ steps }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s.label} className={`step ${s.state}`}>
          <div className="c">
            {s.state === 'done' ? <Check size={16} strokeWidth={3} /> : i + 1}
          </div>
          <div className="l">{s.label}</div>
          {s.sub && <div className="s">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function PipelineDots({ items }) {
  const color = '#1A6DF0';
  return (
    <div>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        {items.map((it) => (
          <div key={it.label} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{it.value}</div>
            <div className="small muted">{it.label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'relative', height: 28, marginTop: 14 }}>
        <div
          style={{
            position: 'absolute',
            left: '10%',
            right: '10%',
            top: 12,
            height: 4,
            borderRadius: 2,
            background: 'linear-gradient(90deg, #B6D0FB, #1350B8)',
          }}
        />
        <div className="row between" style={{ position: 'relative' }}>
          {items.map((it, i) => (
            <div key={it.label} style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.45 + (i / items.length) * 0.55,
                  border: '3px solid #fff',
                  boxShadow: '0 0 0 1px #dbe5f5',
                  marginTop: 3,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MiniCalendar({ month, marks = {}, today, onPrev, onNext, title }) {
  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { first, count, y, m };
  }, [month]);
  const cells = [];
  for (let i = 0; i < days.first; i++) cells.push(<div key={`b${i}`} />);
  for (let d = 1; d <= days.count; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const mark = marks[date];
    cells.push(
      <div
        key={date}
        className={`d ${mark?.kind || ''} ${date === today ? 'today' : ''}`}
        title={mark?.title}
      >
        {d}
      </div>,
    );
  }
  return (
    <div>
      <div className="row between mb-8">
        <button type="button" className="btn ghost sm" onClick={onPrev} aria-label="Previous month">
          ‹
        </button>
        <b>
          {title ||
            new Date(Date.UTC(days.y, days.m - 1, 1)).toLocaleString('en-US', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            })}
        </b>
        <button type="button" className="btn ghost sm" onClick={onNext} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="calendar">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="dh">
            {d}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}
