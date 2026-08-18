import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[11px] leading-[18px] whitespace-nowrap border',
  {
    variants: {
      variant: {
        default: 'bg-elevated text-ink-secondary border-transparent',
        outline: 'bg-transparent text-ink-tertiary border-line',
        accent: 'bg-accent-muted text-accent border-transparent',
        success: 'bg-success/8 text-success border-transparent',
        warning: 'bg-warning/10 text-warning border-transparent',
        danger: 'bg-danger/8 text-danger border-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
