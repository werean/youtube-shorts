/**
 * Componentes auxiliares para Whisper Config Dialog
 * Fornece componentes reutilizáveis com tooltips e descrições
 */

import React, { useState, useRef } from "react";

interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

export function Tooltip({ text, children }: TooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      // Posiciona o tooltip à direita do ícone, centralizado verticalmente
      setTooltipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      });
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        display: "inline-block",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ cursor: "help", display: "inline-block" }}>{children}</div>
      {showTooltip && (
        <div
          style={{
            position: "fixed",
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
            transform: "translateY(-50%)",
            backgroundColor: "#1f2937",
            color: "#fff",
            padding: "12px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            whiteSpace: "normal",
            maxWidth: "380px",
            minWidth: "220px",
            zIndex: 99999,
            boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
            pointerEvents: "none",
            lineHeight: "1.5",
            border: "1px solid #374151",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

interface ConfigFieldProps {
  label: string;
  description?: string;
  tooltip?: string;
  children: React.ReactNode;
}

export function ConfigField({ label, description, tooltip, children }: ConfigFieldProps) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: "8px", gap: "8px" }}>
        <label
          style={{
            fontSize: "14px",
            fontWeight: "500",
            color: "#333",
          }}
        >
          {label}
        </label>
        {tooltip && (
          <Tooltip text={tooltip}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                backgroundColor: "#e5e7eb",
                color: "#6b7280",
                fontSize: "12px",
                fontWeight: "bold",
                cursor: "help",
              }}
            >
              ?
            </span>
          </Tooltip>
        )}
      </div>
      {description && (
        <p
          style={{
            fontSize: "12px",
            color: "#666",
            margin: "4px 0 8px 0",
            fontStyle: "italic",
          }}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
}: TextInputProps) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      min={min}
      max={max}
      style={{
        width: "100%",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid #ddd",
        fontSize: "14px",
        boxSizing: "border-box",
        fontFamily: "inherit",
      }}
    />
  );
}

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: TextAreaProps) {
  return (
    <textarea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: "100%",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid #ddd",
        fontSize: "14px",
        boxSizing: "border-box",
        fontFamily: "inherit",
        resize: "vertical",
      }}
    />
  );
}

interface SelectInputProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string | number }>;
}

export function SelectInput({ value, onChange, options }: SelectInputProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid #ddd",
        fontSize: "14px",
        boxSizing: "border-box",
        fontFamily: "inherit",
        backgroundColor: "#fff",
      }}
    >
      <option value="">-- Selecione --</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: "inline-block",
        width: "48px",
        height: "24px",
        borderRadius: "12px",
        border: "none",
        backgroundColor: checked ? "#10b981" : "#d1d5db",
        cursor: "pointer",
        position: "relative",
        transition: "background-color 0.2s",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "24px" : "2px",
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          backgroundColor: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

interface MultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: Array<{ id: string; label: string; description?: string }>;
}

export function MultiSelect({ values, onChange, options }: MultiSelectProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
      {options.map((option) => {
        const isSelected = values.includes(option.id);
        return (
          <button
            key={option.id}
            onClick={() => {
              onChange(isSelected ? values.filter((v) => v !== option.id) : [...values, option.id]);
            }}
            title={option.description}
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: isSelected ? "2px solid #10b981" : "1px solid #ccc",
              background: isSelected ? "#d1fae5" : "#fff",
              cursor: "pointer",
              fontWeight: isSelected ? "600" : "400",
              color: isSelected ? "#10b981" : "#666",
              fontSize: "14px",
              transition: "all 0.2s",
            }}
          >
            {isSelected ? "✓ " : ""}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
}

export function ConfigSection({ title, icon = "⚙️", children }: SectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      style={{
        marginBottom: "24px",
        borderTop: "1px solid #e5e7eb",
        paddingTop: "16px",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "16px",
          fontWeight: "600",
          color: "#333",
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: "0 0 12px 0",
          width: "100%",
          justifyContent: "space-between",
        }}
      >
        <span>
          {icon} {title}
        </span>
        <span style={{ fontSize: "14px", color: "#999" }}>{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && <div style={{ paddingLeft: "0" }}>{children}</div>}
    </div>
  );
}
