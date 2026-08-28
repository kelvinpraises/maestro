// Ported from maestro-redacted molecules/dialog (Radix) — kept to the pieces setup.tsx uses.
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from '@phosphor-icons/react'
import { cn } from '@/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn('fixed inset-0 z-50 bg-black/40', className)} {...props} />
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn('card-pop fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 p-5', className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="press-pop absolute right-4 top-4 rounded-full p-1 opacity-60 hover:opacity-100">
          <XIcon className="size-4" weight="bold" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />
}
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('font-display text-lg font-extrabold', className)} {...props} />
}
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-[13px] font-semibold opacity-70', className)} {...props} />
}

export { Dialog, DialogTrigger, DialogPortal, DialogOverlay, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
