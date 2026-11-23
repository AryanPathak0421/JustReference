import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { EmptyState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Value used for sorting and CSV export. Omit to make the column unsortable. */
  value?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Text fields to search in. Omit to hide the search box. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  /** File name (without extension) for CSV export. Omit to hide the export button. */
  exportName?: string;
  className?: string;
}

/**
 * Client-side table with search, sorting, pagination and CSV export.
 * In Phase 1+ the same props are fed from server-side paginated queries for large datasets.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  searchText,
  searchPlaceholder = 'Search…',
  pageSize = 10,
  toolbar,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  exportName,
  className,
}: DataTableProps<T>) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let out = rows;
    if (q && searchText) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        const v = col.value;
        out = [...out].sort((a, b) => {
          const x = v(a), y = v(b);
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return sort.dir === 'asc' ? r : -r;
        });
      }
    }
    return out;
  }, [rows, q, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  };

  const exportCsv = () => {
    const cols = columns.filter((c) => c.value);
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c.header)).join(','), ...filtered.map((r) => cols.map((c) => esc(c.value!(r))).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${exportName}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const alignCls = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  return (
    <div className={className}>
      {(searchText || toolbar || exportName) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchText && (
            <label className="relative min-w-0 flex-1 sm:max-w-72">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder={searchPlaceholder}
                className="h-8.5 w-full rounded-lg border border-line bg-white pr-3 pl-9 text-[13px] outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-50"
              />
            </label>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {toolbar}
            {exportName && (
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length} leftIcon={<Download className="size-3.5" />}>
                Export
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-canvas">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('border-b border-line px-3 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase', alignCls(c.align))}
                >
                  {c.value ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                      {c.header}
                      {sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-50" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: Math.min(pageSize, 5) }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className="border-b border-line-2 px-3 py-3.5"><Skeleton className="h-4 w-full max-w-32" /></td>
                    ))}
                  </tr>
                ))
              : visible.map((r) => (
                  <tr key={rowKey(r)} className="transition-colors last:[&>td]:border-b-0 hover:bg-[#fafbfd]">
                    {columns.map((c) => (
                      <td key={c.key} className={cn('border-b border-line-2 px-3 py-3 text-ink-2', alignCls(c.align), c.className)}>{c.cell(r)}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <EmptyState title={q ? 'No matching results' : emptyTitle} description={q ? `Nothing matches “${q}”. Try a different search.` : emptyDescription} />
        )}
      </div>

      {!loading && filtered.length > pageSize && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
          <span>
            Showing {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
            <span className="px-2 font-medium text-ink-2">{current} / {pages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(current + 1)} disabled={current === pages} aria-label="Next page"><ChevronRight className="size-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
