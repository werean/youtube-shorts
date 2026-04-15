import type { CSSProperties, InputHTMLAttributes } from "react";

interface AppInputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

export function AppInput({ fullWidth = false, style, ...rest }: AppInputProps) {
  const mergedStyle: CSSProperties = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(style || {}),
  };

  return <input style={mergedStyle} {...rest} />;
}
