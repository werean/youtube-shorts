import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type StudioTab = "workspace" | "render-queue" | "completed";

export interface StudioTopbarProps {
  activeTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  activeVideoTitle?: string | null;
  gpuStatus?: "online" | "busy" | "offline";
  gpuLabel?: string;
  onOpenSettings?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function StudioTopbar({
  activeTab,
  onTabChange,
  activeVideoTitle,
  gpuStatus = "online",
  gpuLabel = "GPU ONLINE",
  onOpenSettings,
  actions,
  className,
}: StudioTopbarProps) {
  const tabs: { id: StudioTab; label: string }[] = [
    { id: "workspace", label: "Workspace" },
    { id: "render-queue", label: "Fila de Render" },
    { id: "completed", label: "Concluidos" },
  ];

  return (
    <header
      className={cn(
        "relative z-40 flex h-14 w-full select-none items-center justify-between border-b border-white/[0.08] bg-[#09090b]/80 px-4 backdrop-blur-xl",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        className,
      )}
    >
      {/* Esquerda: Identidade ClipFlow + Titulo do Video Ativo */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.04] shadow-[0_0_12px_rgba(255,255,255,0.08)]">
            <svg
              className="h-4 w-4 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="2" width="20" height="20" rx="4" />
              <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
              <line x1="2" y1="7" x2="6" y2="7" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="2" y1="17" x2="6" y2="17" />
              <line x1="18" y1="7" x2="22" y2="7" />
              <line x1="18" y1="12" x2="22" y2="12" />
              <line x1="18" y1="17" x2="22" y2="17" />
            </svg>
          </div>
          <span className="text-body font-semibold tracking-tight text-white">ClipFlow</span>
        </div>

        {activeVideoTitle ? (
          <>
            <span className="text-text-3 font-light text-body-sm">/</span>
            <div className="flex items-center gap-2 max-w-[280px] sm:max-w-md truncate">
              <span className="truncate text-body-sm font-medium text-text-2 hover:text-text-1 transition-colors">
                {activeVideoTitle}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {/* Centro: Segmented Control com visual Liquid Glass */}
      <nav
        aria-label="Navegacao do Studio"
        className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.03] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] backdrop-blur-md"
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative rounded-lg px-3.5 py-1 text-body-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-white/[0.1] text-white shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.18)]"
                  : "text-text-2 hover:text-text-1 hover:bg-white/[0.03]",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Direita: Indicador de Hardware + Acoes + Botao de Configuracoes */}
      <div className="flex items-center gap-2.5">
        {actions}

        {/* Indicador de Hardware */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
          <svg
            className="h-3.5 w-3.5 text-text-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
          </svg>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                gpuStatus === "online" &&
                  "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse",
                gpuStatus === "busy" &&
                  "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse",
                gpuStatus === "offline" && "bg-zinc-600",
              )}
            />
            <span className="text-[11px] font-mono tracking-wider text-text-2">
              {gpuLabel}
            </span>
          </div>
        </div>

        {/* Botao de Configuracoes com icone SVG elegante */}
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            title="Configuracoes"
            aria-label="Configuracoes do sistema"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-text-2 transition-all duration-150 hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white active:scale-95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}
