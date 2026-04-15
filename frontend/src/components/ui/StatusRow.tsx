import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Badge, type BadgeVariant } from "./Badge";

export type StatusRowState = "ready" | "processing" | "error";

export interface StatusRowProps extends HTMLAttributes<HTMLDivElement> {
  state: StatusRowState;
  text: ReactNode;
  tag?: ReactNode;
}

const dotStyles: Record<StatusRowState, string> = {
  ready: "bg-success",
  processing: "bg-warning",
  error: "bg-danger",
};

const tagVariant: Record<StatusRowState, BadgeVariant> = {
  ready: "success",
  processing: "warning",
  error: "danger",
};

export function StatusRow({ state, text, tag, className, ...rest }: StatusRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)} {...rest}>
      <div className="flex min-w-0 items-center gap-2 text-body-sm text-text-2">
        <span
          className={cn("h-2 w-2 flex-none rounded-full", dotStyles[state])}
          aria-hidden="true"
        />
        <span className="truncate">{text}</span>
      </div>
      {tag ? <Badge variant={tagVariant[state]}>{tag}</Badge> : null}
    </div>
  );
}
