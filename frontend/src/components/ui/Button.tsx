import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { SpinnerGap } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5",
  md: "h-9 px-4 text-base gap-1.5",
  lg: "h-10 px-5 text-base gap-2",
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border border-transparent hover:bg-accent-hover active:bg-accent-active active:scale-[0.98] disabled:opacity-45",
  secondary:
    "bg-white/[0.08] text-text-1 border border-line hover:bg-white/[0.14] disabled:opacity-45",
  ghost:
    "bg-white/[0.06] text-text-1 border border-line hover:bg-white/[0.12] disabled:opacity-45",
  destructive:
    "bg-white/[0.06] text-text-1 border border-line hover:bg-[var(--danger-bg)] hover:text-danger disabled:opacity-45",
  danger:
    "bg-white/[0.06] text-text-1 border border-line hover:bg-[var(--danger-bg)] hover:text-danger disabled:opacity-45",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "ghost",
    size = "md",
    leadingIcon,
    leftIcon,
    rightIcon,
    loading = false,
    loadingLabel = "Carregando…",
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const resolvedLeadingIcon = leadingIcon ?? leftIcon;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-pill font-medium leading-none transition-[background-color,transform,border-color,color] duration-fast ease-out",
        "disabled:cursor-not-allowed select-none",
        sizeStyles[size],
        variantStyles[variant],
        fullWidth ? "w-full" : "",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <SpinnerGap className="h-3.5 w-3.5 animate-spin shrink-0" weight="regular" aria-hidden="true" />
      ) : resolvedLeadingIcon ? (
        <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
          {resolvedLeadingIcon}
        </span>
      ) : null}
      {children ? <span>{loading ? loadingLabel : children}</span> : null}
      {!loading && rightIcon ? (
        <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
          {rightIcon}
        </span>
      ) : null}
    </button>
  );
});
