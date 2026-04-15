import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../shared/classNames";
import { Spinner } from "../../foundation/Spinner/Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  type?: "button" | "submit" | "reset";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel = "Carregando",
    leftIcon,
    rightIcon,
    fullWidth = false,
    className = "",
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
      className={cn(
        "ui-button",
        `ui-button--${variant}`,
        `ui-button--${size}`,
        fullWidth ? "ui-button--full" : "",
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="ui-button__content">
        {loading ? <Spinner size="sm" label={loadingLabel} /> : leftIcon}
        <span>{children || (loading ? loadingLabel : "Sem rótulo")}</span>
        {!loading ? rightIcon : null}
      </span>
    </button>
  );
});


