import type { CSSProperties, SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface AppSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fullWidth?: boolean;
}

const ARROW_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23a1a1aa' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

export function AppSelect({
  fullWidth = false,
  className,
  style,
  children,
  ...rest
}: AppSelectProps) {
  const resolvedBackgroundColor =
    style?.backgroundColor ||
    (typeof style?.background === "string" ? style.background : undefined);
  const restStyle: CSSProperties = { ...(style || {}) };
  delete (restStyle as { background?: string }).background;

  const mergedStyle: CSSProperties = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...restStyle,
    ...(resolvedBackgroundColor ? { backgroundColor: resolvedBackgroundColor } : {}),
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage: ARROW_ICON,
    backgroundRepeat: "no-repeat",
    backgroundSize: "10px 6px",
    backgroundPosition: "calc(100% - 16px) center",
    paddingRight: "2.5rem",
  };

  return (
    <select
      className={cn(
        "h-9 px-3 text-xs bg-zinc-900/90 border border-white/10 rounded-xl text-zinc-100 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all duration-200 cursor-pointer",
        fullWidth ? "w-full" : "",
        className,
      )}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </select>
  );
}
