import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/Button";

export interface TopbarNavItem {
  id: string;
  label: string;
}

export interface TopbarProps extends HTMLAttributes<HTMLElement> {
  navItems: TopbarNavItem[];
  activeNavId: string;
  onNavChange: (id: string) => void;
  logoIcon?: ReactNode;
  wordmark?: string;
  actions?: ReactNode;
}

function DefaultLogoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M4 6h16v12H4zM9 9v6l6-3-6-3z" fill="currentColor" />
    </svg>
  );
}

export function Topbar({
  navItems,
  activeNavId,
  onNavChange,
  logoIcon,
  wordmark = "ClipFlow",
  actions,
  className,
  ...rest
}: TopbarProps) {
  return (
    <header
      className={cn(
        "h-[50px] border-b-[0.5px] border-border-1 bg-bg-1 px-4",
        "flex items-center justify-between gap-4",
        className,
      )}
      {...rest}
    >
      <div className="inline-flex items-center gap-2 text-body font-medium text-text-1">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] border-[0.5px] border-border-1 bg-bg-2">
          {logoIcon ?? <DefaultLogoIcon />}
        </span>
        <span>{wordmark}</span>
      </div>

      <nav className="inline-flex items-center gap-1">
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={() => onNavChange(item.id)}
            className={cn(item.id === activeNavId ? "bg-bg-2 text-text-1 border-border-2" : "")}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="inline-flex min-w-[180px] items-center justify-end gap-2">{actions}</div>
    </header>
  );
}
