import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { LoadingOverlay } from "./LoadingOverlay";

export interface CardProps<T extends ElementType = "section"> extends Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "title"
> {
  as?: T;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  compact?: boolean;
}

export function Card<T extends ElementType = "section">({
  as,
  title,
  description,
  actions,
  footer,
  loading = false,
  loadingLabel = "Carregando conteúdo",
  compact = false,
  className = "",
  children,
  ...rest
}: CardProps<T>) {
  const Component = (as || "section") as ElementType;

  return (
    <Component
      className={["ui-card", compact ? "ui-card--compact" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-busy={loading || undefined}
      {...rest}
    >
      {(title || description || actions) && (
        <header className="ui-card__header">
          <div>
            {title ? <h3 className="ui-card__title">{title}</h3> : null}
            {description ? <p className="ui-card__description">{description}</p> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </header>
      )}

      <div className="ui-card__body">{children}</div>

      {footer ? <footer className="ui-card__footer">{footer}</footer> : null}

      <LoadingOverlay open={loading} label={loadingLabel} />
    </Component>
  );
}
