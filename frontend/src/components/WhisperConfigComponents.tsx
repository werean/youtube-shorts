import React, { useState, useRef } from "react";
import { cn } from "../lib/utils";

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
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="cursor-help inline-block">{children}</div>
      {showTooltip && (
        <div
          style={{
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
          }}
          className="fixed -translate-y-1/2 z-[99999] max-w-sm min-w-[220px] rounded-xl border border-white/15 bg-[#121218]/95 p-3 text-xs text-zinc-200 shadow-2xl backdrop-blur-2xl pointer-events-none leading-relaxed animate-in fade-in duration-150"
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
    <div className="space-y-1.5 mb-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-white">
          {label}
        </label>
        {tooltip && (
          <Tooltip text={tooltip}>
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/10 text-zinc-400 hover:text-white text-[10px] font-bold cursor-help transition-colors">
              ?
            </span>
          </Tooltip>
        )}
      </div>
      {description && (
        <p className="text-[11px] text-zinc-400 leading-normal">
          {description}
        </p>
      )}
      <div className="pt-0.5">{children}</div>
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
      className="w-full h-9 px-3 text-xs font-mono bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all duration-200"
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
      className="w-full p-3 text-xs font-mono bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all duration-200 resize-y"
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
      className="w-full h-9 px-3 text-xs bg-zinc-900 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all duration-200 cursor-pointer"
    >
      <option value="">-- Selecione --</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">
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
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 focus:outline-none",
        checked ? "bg-white justify-end" : "bg-zinc-800 justify-start",
      )}
    >
      <div
        className={cn(
          "w-4 h-4 rounded-full shadow-md transition-all duration-200",
          checked ? "bg-zinc-950" : "bg-zinc-400",
        )}
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((option) => {
        const isSelected = values.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              onChange(isSelected ? values.filter((v) => v !== option.id) : [...values, option.id]);
            }}
            title={option.description}
            className={cn(
              "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all duration-200",
              isSelected
                ? "bg-white/[0.1] border-white/30 shadow-[0_2px_10px_rgba(255,255,255,0.08),inset_0_1px_0_0_rgba(255,255,255,0.2)] text-white"
                : "bg-white/[0.02] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] text-zinc-300",
            )}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-semibold">{option.label}</span>
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  isSelected ? "bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" : "bg-zinc-700",
                )}
              />
            </div>
            {option.description && (
              <span className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">{option.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  showTopSeparator?: boolean;
}

export function ConfigSection({ title, children, showTopSeparator = true }: SectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn("mb-5", showTopSeparator && "pt-4 border-t border-white/[0.08]")}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:text-white transition-colors"
      >
        <span>{title}</span>
        <svg
          className={cn("w-4 h-4 text-zinc-400 transition-transform duration-200", expanded ? "rotate-180" : "rotate-0")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && <div className="pt-2">{children}</div>}
    </div>
  );
}
