import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export type GlassButtonVariant = "primary" | "glass" | "danger" | "ghost";
export type GlassButtonSize = "sm" | "md";

export interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant of the glass button */
  variant?: GlassButtonVariant;
  /** Size dimension */
  size?: GlassButtonSize;
  /** Leading icon slot (clean SVG icon recommended) */
  leadingIcon?: ReactNode;
  /** Alias for leadingIcon */
  icon?: ReactNode;
  /** Trailing icon slot (clean SVG icon recommended) */
  trailingIcon?: ReactNode;
  /** Loading state with subtle SVG spinner */
  loading?: boolean;
  /** Optional accessible label when loading */
  loadingLabel?: string;
  /** Whether to occupy 100% width of the parent container */
  fullWidth?: boolean;
  /** Whether to animate subtle scale down on click */
  activeScale?: boolean;
}

const sizeStyles: Record<GlassButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
};

const iconSizes: Record<GlassButtonSize, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

const variantStyles: Record<GlassButtonVariant, string> = {
  // High-contrast elegant translucent white
  primary: cn(
    "bg-white text-zinc-950 font-semibold",
    "shadow-[0_2px_12px_rgba(255,255,255,0.2),inset_0_1px_0_rgba(255,255,255,0.8)]",
    "hover:bg-zinc-100 hover:shadow-[0_4px_16px_rgba(255,255,255,0.28)]",
    "disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none",
  ),
  // Frosted liquid glass with top specular edge highlight
  glass: cn(
    "bg-white/[0.06] text-zinc-100 font-medium",
    "backdrop-blur-md",
    "border border-white/[0.10]",
    "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14)]",
    "hover:bg-white/[0.12] hover:border-white/[0.18] hover:text-white",
    "disabled:bg-white/[0.02] disabled:border-white/[0.04] disabled:text-zinc-600 disabled:shadow-none",
  ),
  // Subtle crimson frosted glass for deletion or discard actions
  danger: cn(
    "bg-red-500/10 text-red-400 font-medium",
    "backdrop-blur-md",
    "border border-red-500/20",
    "shadow-[inset_0_1px_0_0_rgba(239,68,68,0.15)]",
    "hover:bg-red-500/20 hover:border-red-500/35 hover:text-red-300",
    "disabled:bg-red-500/[0.04] disabled:border-red-500/10 disabled:text-zinc-600 disabled:shadow-none",
  ),
  // Borderless glass
  ghost: cn(
    "bg-transparent text-zinc-300 font-medium",
    "hover:bg-white/[0.08] hover:text-white",
    "disabled:bg-transparent disabled:text-zinc-600",
  ),
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        className="opacity-20"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        className="opacity-90"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  {
    variant = "glass",
    size = "md",
    leadingIcon,
    icon,
    trailingIcon,
    loading = false,
    loadingLabel,
    fullWidth = false,
    activeScale = true,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const effectiveLeadingIcon = leadingIcon ?? icon;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center select-none font-sans outline-none",
        "transition-all duration-200 ease-out",
        "focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-black",
        "disabled:cursor-not-allowed",
        activeScale && !isDisabled && "active:scale-[0.98]",
        sizeStyles[size],
        variantStyles[variant],
        fullWidth ? "w-full" : "",
        className,
      )}
      {...rest}
    >
      {/* Leading icon or loading spinner */}
      {loading ? (
        <Spinner className={iconSizes[size]} />
      ) : effectiveLeadingIcon ? (
        <span className={cn("inline-flex items-center justify-center shrink-0", iconSizes[size])} aria-hidden="true">
          {effectiveLeadingIcon}
        </span>
      ) : null}

      {/* Button Text */}
      <span className="truncate">
        {loading && loadingLabel ? loadingLabel : children}
      </span>

      {/* Trailing Icon */}
      {!loading && trailingIcon && (
        <span className={cn("inline-flex items-center justify-center shrink-0", iconSizes[size])} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  );
});
