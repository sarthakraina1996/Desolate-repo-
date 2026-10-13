// Trello-style board: columns of cards with covers, labels and badges, drag and drop
// between and within columns, and "Add a card" at the bottom of each column.
import { Fragment, useEffect, useRef, useState } from 'react';
import { Plus, X, MoreHorizontal, ChevronsLeftRight, Paperclip, MessageSquare, CheckSquare, Clock, Ban } from 'lucide-react';
import { usePref } from './store.jsx';
import { FileThumb, useClickOutside, alpha } from './ui.jsx';
import { daysFrom, fmtDate } from './format.js';

// Position for a card dropped between two neighbours (sorted ascending).
function sortBetween(prev, next) {
  if (prev == null && next == null) return 1;
  if (prev == null) return next - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

function AddCard({ onAdd, onClose, placeholder, extra }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async (e) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd(title.trim());
    setBusy(false);
    if (ok !== false) {
      setTitle('');
      ref.current?.focus();
    }
  };
  return (
    <form className="kb-add-form" onSubmit={submit}>
      <textarea ref={ref} className="kb-add-input" rows={2} value={title} placeholder={placeholder} aria-label={placeholder} maxLength={240}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e);
          if (e.key === 'Escape') onClose();
        }} />
      {extra}
      <div className="row gap-6">
        <button type="submit" className="btn sm primary" disabled={busy || !title.trim()}>Add card</button>
        <button type="button" className="icon-btn sm-x" onClick={onClose} aria-label="Cancel"><X size={18} /></button>
      </div>
    </form>
  );
}

function ColumnMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn sm-x" aria-label="List actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}><MoreHorizontal size={17} /></button>
      {open && (
        <div className="dropdown menu" role="menu" style={{ minWidth: 200 }}>
          <div className="head" style={{ fontSize: 13 }}>List actions</div>
          {items.filter(Boolean).map((it, i) => (
            <button key={i} type="button" role="menuitem" className="item" onClick={() => { setOpen(false); it.onClick(); }}>{it.icon && <it.icon size={15} />}{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * columns: [{ key, title, color, cards, canAdd, addPlaceholder, accepts(card), note }]
 * cards need { id, sort }; renderCard(card) draws the inside of a card.
 */
export function Board({ id, columns, renderCard, onOpen, onMove, onAdd, canDrag, onSort, composerExtra, sortOptions = [] }) {
  const [drag, setDragState] = useState(null); // { card, from }
  // Mirrors `drag` synchronously: dragover can fire before React re-renders after dragstart.
  const dragRef = useRef(null);
  const setDrag = (d) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [over, setOver] = useState(null); // { col, index }
  const [adding, setAdding] = useState(null);
  const [collapsed, setCollapsed] = usePref(`bpm.board.${id}.collapsed`, []);
  const lists = useRef({});

  const indexAt = (colKey, y) => {
    const els = [...(lists.current[colKey]?.querySelectorAll('[data-card]') || [])].filter((el) => Number(el.dataset.card) !== dragRef.current?.card.id);
    const i = els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i === -1 ? els.length : i;
  };

  const drop = (col, y) => {
    const drag = dragRef.current;
    if (!drag) return;
    const list = col.cards.filter((c) => c.id !== drag.card.id);
    const index = indexAt(col.key, y);
    const sort = sortBetween(list[index - 1]?.sort, list[index]?.sort);
    const card = drag.card;
    setDrag(null);
    setOver(null);
    if (col.key === drag.from && (list[index - 1]?.id === card.prevId && list[index]?.id === card.nextId)) return;
    onMove(card, col.key, sort);
  };

  return (
    <div className="kb" onDragEnd={() => { setDrag(null); setOver(null); }}>
      {columns.map((col) => {
        const blocked = !!drag && !!col.accepts && !col.accepts(drag.card);
        const refuses = () => { const d = dragRef.current; return !d || (col.accepts && !col.accepts(d.card)); };
        if (collapsed.includes(col.key)) {
          return (
            <button key={col.key} type="button" className="kb-col collapsed" onClick={() => setCollapsed(collapsed.filter((k) => k !== col.key))} title={`Expand ${col.title}`}>
              <span className="kb-col-bar" style={{ background: col.color }} />
              <span className="kb-vtitle">{col.title}</span>
              <span className="pill-num">{col.cards.length}</span>
            </button>
          );
        }
        const list = col.cards;
        const showLine = over?.col === col.key && drag && !blocked;
        // The dragged card stays in place (faded); the drop line is placed by position
        // among the other cards, matching indexAt().
        let k = 0;
        const rendered = list.map((card, i) => {
          const isDragged = drag?.card.id === card.id;
          const lineHere = showLine && !isDragged && over.index === k;
          if (!isDragged) k++;
          return (
            <Fragment key={card.id}>
              {lineHere && <div className="kb-drop" />}
              <article
                data-card={card.id}
                className={`kb-card ${isDragged ? 'dragging' : ''}`}
                draggable={canDrag(card)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(card.id));
                  setDrag({ card: { ...card, prevId: list[i - 1]?.id, nextId: list[i + 1]?.id }, from: col.key });
                }}
                onClick={() => onOpen(card)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(card)}
                tabIndex={0}
                role="button"
              >
                {renderCard(card)}
              </article>
            </Fragment>
          );
        });
        return (
          <section key={col.key} className={`kb-col ${showLine ? 'over' : ''} ${blocked ? 'blocked' : ''}`} aria-label={col.title}
            onDragOver={(e) => {
              if (refuses()) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const index = indexAt(col.key, e.clientY);
              if (over?.col !== col.key || over.index !== index) setOver({ col: col.key, index });
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver((o) => (o?.col === col.key ? null : o)); }}
            onDrop={(e) => { e.preventDefault(); if (!refuses()) drop(col, e.clientY); }}>
            <header className="kb-head">
              <span className="kb-col-bar" style={{ background: col.color }} />
              <h4 title={col.title}>{col.title}</h4>
              <span className="pill-num">{list.length}</span>
              <ColumnMenu items={[
                col.canAdd && { label: 'Add a card', icon: Plus, onClick: () => setAdding(col.key) },
                ...(onSort && list.length > 1 ? sortOptions.map((o) => ({ label: `Sort by ${o.label}`, onClick: () => onSort(col, o.value) })) : []),
                { label: 'Collapse list', icon: ChevronsLeftRight, onClick: () => setCollapsed([...collapsed, col.key]) },
              ]} />
            </header>
            {col.note && <div className="kb-note">{col.note}</div>}
            {blocked && <div className="kb-blocked"><Ban size={14} />{col.blockedText || 'Cannot move this card here'}</div>}
            <div className="kb-list" ref={(el) => (lists.current[col.key] = el)}>
              {rendered}
              {showLine && over.index >= k && <div className="kb-drop" />}
              {list.length === 0 && !showLine && <div className="kb-empty">{col.empty || 'No cards'}</div>}
            </div>
            {col.canAdd && (adding === col.key ? (
              <AddCard placeholder={col.addPlaceholder || 'Enter a title for this card'} onClose={() => setAdding(null)} onAdd={(title) => onAdd(col, title)} extra={composerExtra} />
            ) : (
              <button type="button" className="kb-add" onClick={() => setAdding(col.key)}><Plus size={16} />Add a card</button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- card pieces

const LABEL_COLORS = ['#1fa855', '#f2a600', '#f97316', '#e31b3b', '#7c5cfc', '#1a6df0', '#1fb2d6', '#65a30d', '#ef4778', '#475569'];
export function labelColor(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

export function Labels({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="kb-labels">
      {shown.map((l, i) => (
        <span key={i} className="kb-label" style={{ background: l.solid ? l.color : alpha(l.color, 0.16), color: l.solid ? '#fff' : l.color }} title={l.title || l.text}>{l.text}</span>
      ))}
    </div>
  );
}

export function Cover({ file, color }) {
  if (!file) return null;
  return <div className="kb-cover"><FileThumb file={{ ...file, name: 'cover', vertical_color: color }} /></div>;
}

export function DueBadge({ date, today, done, icon: Icon = Clock, label }) {
  if (!date) return null;
  const n = daysFrom(today, date);
  const tone = done ? 'done' : n < 0 ? 'late' : n <= 2 ? 'soon' : '';
  return (
    <span className={`kb-badge due ${tone}`} title={label ? `${label}: ${fmtDate(date, { year: true })}` : fmtDate(date, { year: true })}>
      <Icon size={13} />{fmtDate(date, { today })}
    </span>
  );
}

export function Badges({ checklist, comments, files, children }) {
  return (
    <>
      {children}
      {checklist && checklist.total > 0 && (
        <span className={`kb-badge ${checklist.done === checklist.total ? 'complete' : ''}`} title="Checklist"><CheckSquare size={13} />{checklist.done}/{checklist.total}</span>
      )}
      {comments > 0 && <span className="kb-badge" title="Comments"><MessageSquare size={13} />{comments}</span>}
      {files > 0 && <span className="kb-badge" title="Attachments"><Paperclip size={13} />{files}</span>}
    </>
  );
}
