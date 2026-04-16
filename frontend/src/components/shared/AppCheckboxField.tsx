import type { CSSProperties } from "react";

interface AppCheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
  marginTop?: string;
  labelFontSize?: string;
}

export function AppCheckboxField({
  label,
  checked,
  onChange,
  compact = false,
  marginTop = "0",
  labelFontSize,
}: AppCheckboxFieldProps) {
  const style: CSSProperties = {
    marginTop,
    ["--app-checkbox-label-size" as string]: labelFontSize ?? (compact ? "0.92rem" : "0.96rem"),
  };

  return (
    <label className="field app-checkbox-field" style={style}>
      <input
        className="app-checkbox"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
