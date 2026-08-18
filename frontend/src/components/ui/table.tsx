import * as React from 'react'
import { cn } from '@/lib/utils'

/* Data tables: white card, hairline rows, mono microlabel headers,
   tabular numerals. The wrapper owns horizontal overflow so wide tables
   scroll inside their card instead of the page. */

function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-line-subtle bg-surface">
      <table
        className={cn('w-full caption-bottom border-collapse text-[13px]', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-line', className)} {...props} />
}

function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-line-subtle transition-colors hover:bg-elevated/60 data-[state=error]:bg-danger/4',
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'microlabel sticky top-0 z-10 bg-surface px-3 py-2 text-left align-middle whitespace-nowrap',
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('px-3 py-1.5 align-middle text-ink-secondary', className)}
      {...props}
    />
  )
}

/* Right-aligned numeric cell — the default for token/cost/duration columns. */
function TableNum({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'px-3 py-1.5 align-middle text-right font-mono text-xs tabular-nums text-ink-secondary whitespace-nowrap',
        className
      )}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableNum }
