// Ported verbatim from maestro-redacted atoms/button (soft-neubrutalism
// variants, press-pop physics baked into fills).
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/utils'

const buttonVariants = cva(
  'press-pop inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-display text-sm font-extrabold disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*="size-"])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/60 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  {
    variants: {
      variant: {
        default: 'border-2 border-[var(--m-ink)] bg-[var(--m-green)] text-[var(--primary-foreground)] shadow-[var(--m-pop)] hover:brightness-[1.03]',
        destructive: 'border-2 border-[var(--m-ink)] bg-[var(--m-pink)] text-white shadow-[var(--m-pop)] hover:brightness-105',
        outline: 'border-2 border-[var(--m-ink)] bg-white text-[var(--m-foreground)] shadow-[var(--m-pop)] hover:bg-[var(--m-lavender)]/50',
        secondary: 'border-2 border-[var(--m-ink)] bg-[var(--secondary)] text-[var(--m-foreground)] shadow-[var(--m-pop)] hover:brightness-[0.99]',
        ghost: 'hover:bg-[var(--m-lavender)]/70 hover:text-[var(--m-foreground)]',
        link: 'text-[var(--m-green-ink)] underline-offset-4 hover:underline rounded-md',
      },
      size: {
        default: 'h-11 px-6 py-2 has-[>svg]:px-5',
        sm: 'h-9 gap-1.5 px-4 has-[>svg]:px-3 text-[13px]',
        lg: 'h-14 px-8 text-base has-[>svg]:px-6',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
