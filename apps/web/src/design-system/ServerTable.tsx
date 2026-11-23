import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { EmptyState, ErrorState, Skeleton } from './Feedback';
import type { Column } from './DataTable';

interface ServerTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
}

/** Table for server-side paginated data. Search, filters and sorting live in the page's toolbar. */
export function ServerTable<T>({
  rows, columns, rowKey, loading, error, onRetry, total, page, pageSize, onPageChange, onRowClick,
  emptyTitle = 'Nothing here yet', emptyDescription, emptyAction,
}: ServerTableProps<T>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (error) return <div className="rounded-xl border border-line"><ErrorState description={error instanceof Error ? error.message : undefined} onRetry={onRetry} /></div>;

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="bg-canvas">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('border-b border-line px-3 py-2.5 text-xs font-semibold tracking-wide whitespace-nowrap text-muted uppercase', align(c.align))}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}>{columns.map((c) => <td key={c.key} className="border-b border-line-2 px-3 py-3.5"><Skeleton className="h-4 w-full max-w-32" /></td>)}</tr>
                ))
              : rows?.map((r) => (
                  <tr
                    key={rowKey(r)}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn('transition-colors last:[&>td]:border-b-0 hover:bg-[#fafbfd]', onRowClick && 'cursor-pointer')}
                  >
                    {columns.map((c) => <td key={c.key} className={cn('border-b border-line-2 px-3 py-3 text-ink-2', align(c.align), c.className)}>{c.cell(r)}</td>)}
                  </tr>
                ))}
          </tbody>
        </table>
        {!loading && !rows?.length && <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />}
      </div>
      {!loading && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
          <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString('en-IN')}</span>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft className="size-4" /></Button>
              <span className="px-2 font-medium text-ink-2">{page} / {pages}</span>
              <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight className="size-4" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
