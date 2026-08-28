// Ported verbatim from maestro-redacted atoms/input — field-pop voice.
import * as React from 'react'
import { cn } from '@/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'field-pop file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:opacity-50 flex h-11 w-full min-w-0 px-3.5 py-1 font-display text-base font-bold outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
