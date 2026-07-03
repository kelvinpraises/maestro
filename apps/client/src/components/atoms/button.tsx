import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils";

const buttonVariants = cva(
  // Soft-neubrutalism buttons: heavy display type, chunky radius, and the
  // press-pop physics (translate into the shadow) live in the fill variants.
  "press-pop inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-display text-sm font-extrabold disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/60 focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // Primary: saturated green fill, ink outline, hard offset shadow.
        default:
          "border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop)] hover:brightness-[1.03]",
        destructive:
          "border-2 border-m-ink bg-destructive text-white shadow-[var(--m-pop)] hover:brightness-105 focus-visible:ring-destructive/30",
        // Secondary door: card-style outline — cream fill, same ink + shadow.
        outline:
          "border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop)] hover:bg-accent/50",
        secondary:
          "border-2 border-m-ink bg-secondary text-secondary-foreground shadow-[var(--m-pop)] hover:brightness-[0.99]",
        ghost: "hover:bg-accent/70 hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline rounded-md",
      },
      size: {
        default: "h-11 px-6 py-2 has-[>svg]:px-5",
        sm: "h-9 gap-1.5 px-4 has-[>svg]:px-3 text-[13px]",
        lg: "h-14 px-8 text-base has-[>svg]:px-6",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
