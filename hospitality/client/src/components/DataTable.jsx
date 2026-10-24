// Reusable data table: sortable columns, client or server paging, empty/loading states and
// CSV export of exactly what the table shows.
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { Button, Empty } from './ui.jsx';

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(filename, columns, rows) {
  const cols = columns.filter((c) => c.csv !== false);
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(c.csv ? c.csv(r) : typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// columns: [{ key, label, render(row), value(row) for sorting, num, sortable, csv(row) | false, width }]
// Server mode: pass sort/dir/onSort and page/pageSize/total/onPage.
export function DataTable({
  columns,
  rows,
  rowKey = (r) => r.id,
  onRowClick,
  empty,
  pageSize = 25,
  sort: extSort,
  dir: extDir,
  onSort,
  total,
  page: extPage,
  onPage,
  exportName,
  footer,
  dense,
}) {
  const [sort, setSort] = useState(null);
  const [dir, setDir] = useState('asc');
  const [page, setPage] = useState(0);
  const server = Boolean(onSort || onPage);
  const activeSort = server ? extSort : sort;
  const activeDir = server ? extDir : dir;
  const sorted = useMemo(() => {
    if (server || !sort) return rows;
    const col = columns.find((c) => c.key === sort);
    const val = col?.value || ((r) => r[sort]);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const cmp = x == null ? 1 : y == null ? -1 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, dir, columns, server]);
  const p = server ? extPage || 0 : page;
  const count = server ? total ?? rows.length : sorted.length;
  const visible = server ? sorted : sorted.slice(p * pageSize, (p + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const clickSort = (c) => {
    if (c.sortable === false) return;
    const nextDir = activeSort === c.key && activeDir === 'asc' ? 'desc' : 'asc';
    if (server) onSort?.(c.key, nextDir);
    else {
      setSort(c.key);
      setDir(nextDir);
      setPage(0);
    }
  };
  if (!rows.length && !server) return empty || <Empty />;
  return (
    <div>
      <div className="table-wrap">
        <table className="table" style={dense ? { fontSize: 12.5 } : undefined}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.num ? 'num' : ''} ${c.sortable !== false ? 'sortable' : ''}`}
                  style={{ width: c.width }}
                  onClick={() => clickSort(c)}
                  aria-sort={activeSort === c.key ? (activeDir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.label}
                  {activeSort === c.key && (activeDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={rowKey(r)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {c.render ? c.render(r) : r[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
        {server && !rows.length && (empty || <Empty />)}
      </div>
      {(pages > 1 || exportName) && (
        <div className="pager">
          <span>
            {count ? `${p * pageSize + 1}–${Math.min(count, (p + 1) * pageSize)} of ${count.toLocaleString('en-IN')}` : '0 rows'}
          </span>
          <div className="spacer" />
          {exportName && (
            <Button size="sm" variant="ghost" icon={Download} onClick={() => exportCsv(exportName, columns, sorted)}>
              Export CSV
            </Button>
          )}
          {pages > 1 && (
            <>
              <Button size="sm" disabled={p === 0} onClick={() => (server ? onPage(p - 1) : setPage(p - 1))}>
                Previous
              </Button>
              <span>
                Page {p + 1} of {pages}
              </span>
              <Button size="sm" disabled={p + 1 >= pages} onClick={() => (server ? onPage(p + 1) : setPage(p + 1))}>
                Next
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
