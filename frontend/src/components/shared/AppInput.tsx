import type { CSSProperties, InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface AppInputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export function AppInput({ fullWidth = false, style, ...rest }: AppInputProps) {
  const { className, ...inputProps } = rest;
  const mergedStyle: CSSProperties = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(style || {}),
  };

  return <input className={cn("app-input", className)} style={mergedStyle} {...inputProps} />;
}
