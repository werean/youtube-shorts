import type { HTMLAttributes } from "react";
import { cn } from "../../../lib/utils";
import { StatusRow } from "../../ui/StatusRow";

export interface ModelSelectorProps extends HTMLAttributes<HTMLDivElement> {
  models: string[];
  value: string;
  onChange: (model: string) => void;
  running?: boolean;
}

export function ModelSelector({
  models,
  value,
  onChange,
  running = false,
  className,
  ...rest
}: ModelSelectorProps) {
  return (
    <div className={cn("space-y-2", className)} {...rest}>
      <StatusRow
        state={running ? "processing" : "ready"}
        text={`Model ${value}`}
        tag={running ? "running" : "idle"}
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="select-field h-8 w-full rounded-md border-[0.5px] border-border-1 bg-bg-3 px-2 text-body text-text-1 focus:border-border-3 focus:outline-none"
      >
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </div>
  );
}
