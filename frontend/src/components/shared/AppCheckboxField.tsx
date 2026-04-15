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
  return (
    <label
      className="field"
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "8px",
        marginTop,
        fontSize: labelFontSize ?? (compact ? "0.92rem" : "0.96rem"),
        lineHeight: 1.2,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: 0 }}
      />
      {label}
    </label>
  );
}
