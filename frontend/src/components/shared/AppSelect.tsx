import type { CSSProperties, SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface AppSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fullWidth?: boolean;
}

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
  };

  return (
    <select className={cn("select-field", className)} style={mergedStyle} {...rest}>
      {children}
    </select>
  );
}
