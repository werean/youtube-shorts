import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface MainShellProps extends HTMLAttributes<HTMLDivElement> {
  topbar: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed?: boolean;
}

export function MainShell({
  topbar,
  sidebar,
  sidebarCollapsed = false,
  className,
  children,
  ...rest
}: MainShellProps) {
  return (
    <div className={cn("min-h-screen bg-bg-0 text-text-1", className)} {...rest}>
      <div className="fixed inset-x-0 top-0 z-30 h-[50px]">{topbar}</div>

      <div className="pt-[50px]">
        <div
          className={cn(
            "fixed left-0 top-[50px] z-20 h-[calc(100vh-50px)] ds-transition-layout",
            sidebarCollapsed ? "w-16" : "w-48",
          )}
        >
          {sidebar}
        </div>

        <main
          className={cn(
            "min-h-[calc(100vh-50px)] space-y-6 p-[22px] ds-transition-layout",
            sidebarCollapsed ? "ml-16" : "ml-48",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
