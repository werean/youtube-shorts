import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/Badge";

export type SidebarStage = "pending" | "active" | "done" | "error";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  stage?: SidebarStage;
}

export interface SidebarSection {
  label: string;
  items: SidebarItem[];
}

export interface SidebarProps extends HTMLAttributes<HTMLElement> {
  sections: SidebarSection[];
  activeItemId: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSelectItem: (id: string) => void;
}

function stageColor(stage: SidebarStage): string {
  switch (stage) {
    case "done":
      return "bg-success";
    case "active":
      return "bg-warning";
    case "error":
      return "bg-danger";
    case "pending":
    default:
      return "bg-text-3";
  }
}

function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
    </svg>
  );
}

export function Sidebar({
  sections,
  activeItemId,
  collapsed = false,
  onToggleCollapsed,
  onSelectItem,
  className,
  ...rest
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "h-full border-r-[0.5px] border-border-1 bg-bg-1 p-3 ds-transition-layout",
        collapsed ? "w-16" : "w-48",
        className,
      )}
      {...rest}
    >
      <div className="mb-4 flex items-center justify-between">
        {!collapsed ? <p className="text-caption text-text-3">Workflow</p> : <span />}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] border-[0.5px] border-border-1 text-text-2 ds-transition-color hover:bg-bg-2 hover:text-text-1"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.label} className="space-y-1.5">
            {!collapsed ? <p className="px-1 text-caption text-text-3">{section.label}</p> : null}

            {section.items.map((item) => {
              const active = item.id === activeItemId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectItem(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[6px] border-[0.5px] px-2 py-1.5 ds-transition-color",
                    active
                      ? "border-border-3 bg-bg-2 text-text-1"
                      : "border-transparent text-text-2 hover:border-border-1 hover:bg-bg-2",
                  )}
                >
                  <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-[0.5px] border-border-1 bg-bg-2 text-text-2">
                    {item.icon ?? <PlaceholderIcon />}
                  </span>

                  {!collapsed ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-body-sm">{item.label}</span>
                      {item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
                      <span
                        className={cn("h-2 w-2 rounded-full", stageColor(item.stage ?? "pending"))}
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
