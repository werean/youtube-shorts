import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../shared/classNames";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className = "",
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={cn("ui-empty-state", compact ? "ui-empty-state--compact" : "", className)}
      {...rest}
    >
      {icon ? (
        <div className="ui-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="ui-empty-state__title">{title}</h3>
      {description ? <p className="ui-empty-state__description">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
