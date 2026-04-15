import { cn } from "../../lib/utils";

export interface TabItem {
  id: string;
  label: string;
  badge?: string;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ items, activeId, onChange, className }: TabsProps) {
  return (
    <div
      className={cn("inline-flex rounded-md border-[0.5px] border-border-1 bg-bg-2 p-1", className)}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-body-sm font-medium ds-transition-color",
              active ? "bg-bg-3 text-text-1" : "text-text-2 hover:bg-bg-3/60 hover:text-text-1",
            )}
            aria-pressed={active}
          >
            <span>{item.label}</span>
            {item.badge ? (
              <span className="rounded-[5px] border-[0.5px] border-border-1 px-1.5 py-[1px] text-label text-text-3">
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
