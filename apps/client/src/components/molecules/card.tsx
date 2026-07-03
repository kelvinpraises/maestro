import * as React from "react";

import { cn } from "@/utils";

type CardTint = "butter" | "mint" | "pink" | "sky" | "lilac" | "green";

const cardTints: Record<CardTint, string> = {
  butter: "card-pop-butter",
  mint: "card-pop-mint",
  pink: "card-pop-pink",
  sky: "card-pop-sky",
  lilac: "card-pop-lilac",
  green: "card-pop-green",
};

// The single card voice: chunky ink outline + hard offset shadow on cream
// (soft neubrutalism). Pass `tint` for the refs' pastel flat-fill cards.
function Card({
  className,
  tint,
  ...props
}: React.ComponentProps<"div"> & { tint?: CardTint }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "card-pop gap-6 py-2",
        tint && cardTints[tint],
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col space-y-1.5 p-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-2xl font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-6 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
