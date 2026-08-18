import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors cursor-pointer border focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-ink text-surface border-transparent hover:bg-ink/85',
        outline:
          'bg-surface text-ink-secondary border-line hover:bg-elevated hover:text-ink',
        ghost:
          'bg-transparent text-ink-secondary border-transparent hover:bg-elevated hover:text-ink',
        destructive:
          'bg-surface text-danger border-line hover:border-danger/40 hover:bg-danger/5',
        accent:
          'bg-accent text-white border-transparent hover:bg-accent-hover',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-xs',
        icon: 'h-8 w-8 px-0',
      },
    },
    defaultVariants: {
      variant: 'outline',
      size: 'default',
    },
  }
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export { Button, buttonVariants }
