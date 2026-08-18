import * as React from 'react'
import { cn } from '@/lib/utils'

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-muted transition-colors focus-visible:outline-none focus-visible:border-accent disabled:opacity-45',
        className
      )}
      {...props}
    />
  )
}

// Native select with matching chrome; options stay platform-rendered.
function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink-secondary transition-colors cursor-pointer focus-visible:outline-none focus-visible:border-accent',
        className
      )}
      {...props}
    />
  )
}

export { Input, Select }
