import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-body-sm",
  md: "h-8 px-3 text-body",
  lg: "h-9 px-3.5 text-body-md",
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border-[0.5px] border-border-3 hover:bg-text-1/90 disabled:bg-bg-4 disabled:text-text-3",
  ghost:
    "bg-transparent text-text-2 border-[0.5px] border-border-1 hover:bg-bg-2 hover:text-text-1 hover:border-border-2 disabled:text-text-3",
  destructive:
    "bg-danger text-text-1 border-[0.5px] border-danger hover:bg-danger/90 disabled:bg-bg-4 disabled:text-text-3 disabled:border-border-1",
};

function SpinnerIcon() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-25"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-100"
        fill="none"
      />
    </svg>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "ghost",
    size = "md",
    leadingIcon,
    loading = false,
    loadingLabel = "Loading",
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

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium leading-none ds-transition-color",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-3",
        "disabled:cursor-not-allowed",
        sizeStyles[size],
        variantStyles[variant],
        fullWidth ? "w-full" : "",
        className,
      )}
      {...rest}
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden="true">
        {loading ? <SpinnerIcon /> : leadingIcon}
      </span>
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
});
