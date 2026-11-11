import React, { forwardRef, useEffect, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export type GlassToastVariant = "default" | "success" | "warning" | "danger";

export interface GlassToastProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional bold title */
  title?: string;
  /** Toast message content */
  message: ReactNode;
  /** Visual variant */
  variant?: GlassToastVariant;
  /** Callback fired when user closes the toast or auto-dismiss fires */
  onClose?: () => void;
  /** Auto dismiss duration in ms (omit or pass 0 for persistent toast) */
  duration?: number;
  /** Optional action button on the toast */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Optional custom SVG icon override (ZERO EMOJIS) */
  icon?: ReactNode;
}

const variantStyles: Record<GlassToastVariant, { border: string; glow: string; textAccent: string }> = {
  default: {
    border: "border-white/[0.12]",
    glow: "shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.18)]",
    textAccent: "text-zinc-200",
  },
  success: {
    border: "border-emerald-500/30",
    glow: "shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_-4px_rgba(16,185,129,0.25),inset_0_1px_0_0_rgba(16,185,129,0.3)]",
    textAccent: "text-emerald-400",
  },
  warning: {
    border: "border-amber-500/30",
    glow: "shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_-4px_rgba(245,158,11,0.25),inset_0_1px_0_0_rgba(245,158,11,0.3)]",
    textAccent: "text-amber-400",
  },
  danger: {
    border: "border-red-500/30",
    glow: "shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_-4px_rgba(239,68,68,0.25),inset_0_1px_0_0_rgba(239,68,68,0.3)]",
    textAccent: "text-red-400",
  },
};

function ToastIcon({ variant }: { variant: GlassToastVariant }) {
  if (variant === "success") {
    return (
      <svg
        className="h-4 w-4 text-emerald-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg
        className="h-4 w-4 text-amber-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (variant === "danger") {
    return (
      <svg
        className="h-4 w-4 text-red-400"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return (
    <svg
      className="h-4 w-4 text-zinc-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

export const GlassToast = forwardRef<HTMLDivElement, GlassToastProps>(function GlassToast(
  {
    title,
    message,
    variant = "default",
    onClose,
    duration = 4000,
    action,
    icon,
    className,
    ...rest
  },
  ref,
) {
  useEffect(() => {
    if (!duration || duration <= 0 || !onClose) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const styleConfig = variantStyles[variant];

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn(
        "relative flex items-start gap-3 rounded-xl p-3.5 sm:min-w-[320px] max-w-md",
        "bg-[#13141a]/85 backdrop-blur-[28px] saturate-[180%]",
        "border transition-all duration-200 ease-out animate-in fade-in slide-in-from-bottom-2",
        styleConfig.border,
        styleConfig.glow,
        className,
      )}
      {...rest}
    >
      {/* Leading Icon */}
      <div className="shrink-0 mt-0.5">
        {icon ?? <ToastIcon variant={variant} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-1">
        {title && (
          <div className={cn("text-xs font-semibold tracking-wide mb-0.5", styleConfig.textAccent)}>
            {title}
          </div>
        )}
        <div className="text-xs text-zinc-300 leading-relaxed break-words">
          {message}
        </div>
        {action && (
          <div className="mt-2">
            <button
              type="button"
              onClick={action.onClick}
              className="text-xs font-semibold text-white underline underline-offset-2 hover:text-zinc-200 focus-visible:outline-none"
            >
              {action.label}
            </button>
          </div>
        )}
      </div>

      {/* Close Button */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
});

/**
 * Fixed container for stacking glass toasts on the screen corner
 */
export function GlassToastContainer({
  children,
  position = "bottom-right",
}: {
  children: ReactNode;
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}) {
  const positionClasses = {
    "top-right": "top-5 right-5",
    "top-left": "top-5 left-5",
    "bottom-right": "bottom-5 right-5",
    "bottom-left": "bottom-5 left-5",
  }[position];

  return (
    <div
      aria-label="Notifications"
      className={cn("fixed z-50 flex flex-col gap-2.5 pointer-events-auto", positionClasses)}
    >
      {children}
    </div>
  );
}
