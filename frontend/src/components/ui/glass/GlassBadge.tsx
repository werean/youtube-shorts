import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export type GlassBadgeVariant =
  | "default"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "outline"
  | "score";

export type GlassBadgeSize = "sm" | "md";

export interface GlassBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual variant of the badge */
  variant?: GlassBadgeVariant;
  /** Size dimension */
  size?: GlassBadgeSize;
  /** Optional leading SVG icon */
  icon?: ReactNode;
  /** Whether to show a pulsing indicator dot (e.g., for GPU ONLINE or live status) */
  pulse?: boolean;
  /** Alias for pulse indicator dot */
  dot?: boolean;
  /** Score value specifically for the 'score' variant */
  score?: number | string;
}

const sizeStyles: Record<GlassBadgeSize, string> = {
  sm: "h-5 px-2 text-[10px] gap-1.5 rounded-full font-medium tracking-wide",
  md: "h-6 px-2.5 text-xs gap-1.5 rounded-full font-medium tracking-wide",
};

const variantStyles: Record<GlassBadgeVariant, string> = {
  // Neutral frosted glass
  default: cn(
    "bg-white/[0.06] text-zinc-300",
    "border border-white/[0.08]",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]",
  ),
  neutral: cn(
    "bg-white/[0.06] text-zinc-300",
    "border border-white/[0.08]",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]",
  ),
  // Emerald accent for online / active / success status
  success: cn(
    "bg-emerald-500/10 text-emerald-300",
    "border border-emerald-500/25",
    "shadow-[inset_0_1px_0_0_rgba(16,185,129,0.2),0_0_12px_-2px_rgba(16,185,129,0.25)]",
  ),
  // Amber accent for warnings or in-progress states
  warning: cn(
    "bg-amber-500/10 text-amber-300",
    "border border-amber-500/25",
    "shadow-[inset_0_1px_0_0_rgba(245,158,11,0.2),0_0_12px_-2px_rgba(245,158,11,0.2)]",
  ),
  // Crimson accent for errors or destructive states
  danger: cn(
    "bg-red-500/10 text-red-300",
    "border border-red-500/25",
    "shadow-[inset_0_1px_0_0_rgba(239,68,68,0.2),0_0_12px_-2px_rgba(239,68,68,0.2)]",
  ),
  // High contrast visionOS accent
  accent: cn(
    "bg-white/15 text-white font-semibold",
    "border border-white/30",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25)]",
  ),
  // Crisp minimal outline
  outline: cn(
    "bg-transparent text-zinc-300",
    "border border-white/20",
  ),
  // visionOS high-impact Viral Score pill
  score: cn(
    "bg-white/[0.08] text-white font-semibold",
    "border border-white/[0.18]",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_4px_16px_-2px_rgba(0,0,0,0.5)]",
  ),
};

export const GlassBadge = forwardRef<HTMLSpanElement, GlassBadgeProps>(function GlassBadge(
  {
    variant = "default",
    size = "md",
    icon,
    pulse = false,
    dot = false,
    score,
    className,
    children,
    ...rest
  },
  ref,
) {
  const showDot = pulse || dot;
  const isScoreVariant = variant === "score" && score !== undefined;

  const dotColorClass = {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    accent: "bg-white",
    default: "bg-white",
    neutral: "bg-white",
    outline: "bg-white",
    score: "bg-white",
  }[variant];

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center select-none uppercase tracking-wider backdrop-blur-md",
        sizeStyles[size],
        variantStyles[variant],
        className,
      )}
      {...rest}
    >
      {/* Pulse Dot for status indicators (e.g. GPU ONLINE, Baixando) */}
      {showDot && (
        <span className="relative flex h-2 w-2 items-center justify-center" aria-hidden="true">
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
              dotColorClass,
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-1.5 w-1.5 rounded-full",
              dotColorClass,
            )}
          />
        </span>
      )}

      {/* Leading SVG icon */}
      {icon && (
        <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
          {icon}
        </span>
      )}

      {/* Content */}
      <span>{children}</span>

      {/* Score High-Contrast Metric Pill */}
      {isScoreVariant && (
        <span
          className={cn(
            "ml-1 inline-flex items-center justify-center rounded-full bg-white text-zinc-950 font-bold",
            size === "sm" ? "px-1.5 py-0 text-[9px] min-w-[18px]" : "px-2 py-0.5 text-[11px] min-w-[22px]",
          )}
        >
          {score}
        </span>
      )}
    </span>
  );
});
