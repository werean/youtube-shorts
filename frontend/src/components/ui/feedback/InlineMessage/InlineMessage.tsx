import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../shared/classNames";

export type InlineMessageTone = "info" | "success" | "warning" | "error";

export interface InlineMessageProps extends HTMLAttributes<HTMLDivElement> {
  tone?: InlineMessageTone;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  dismissLabel?: string;
  onDismiss?: () => void;
}

function toneIcon(tone: InlineMessageTone): string {
  switch (tone) {
    case "success":
      return "OK";
    case "warning":
      return "!";
    case "error":
      return "X";
    case "info":
    default:
      return "i";
  }
}

function toneRole(tone: InlineMessageTone): "alert" | "status" {
  return tone === "error" || tone === "warning" ? "alert" : "status";
}

export function InlineMessage({
  tone = "info",
  title,
  children,
  action,
  dismissLabel = "Fechar mensagem",
  onDismiss,
  className = "",
  ...rest
}: InlineMessageProps) {
  const role = toneRole(tone);

  return (
    <div
      className={cn("ui-inline-message", `ui-inline-message--${tone}`, className)}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      {...rest}
    >
      <span className="ui-inline-message__icon" aria-hidden="true">
        {toneIcon(tone)}
      </span>

      <div className="ui-inline-message__content">
        {title ? <p className="ui-inline-message__title">{title}</p> : null}
        <p className="ui-inline-message__text">{children}</p>
        {action ? <div className="ui-inline-message__actions">{action}</div> : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          className="ui-inline-message-dismiss"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          X
        </button>
      ) : null}
    </div>
  );
}
