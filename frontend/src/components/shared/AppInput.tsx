import type { CSSProperties, InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface AppInputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export function AppInput({ fullWidth = false, style, className, ...rest }: AppInputProps) {
  const mergedStyle: CSSProperties = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(style || {}),
  };

  return (
    <input
      className={cn(
        "h-9 px-3 text-xs bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all duration-200",
        fullWidth ? "w-full" : "",
        className,
      )}
      style={mergedStyle}
      {...rest}
    />
  );
}
