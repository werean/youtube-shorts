import { useState, useRef, useEffect, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export type StudioTab = "workspace" | "render-queue" | "completed";

export interface StudioTopbarProps {
  activeTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  activeVideoTitle?: string | null;
  gpuStatus?: "online" | "busy" | "offline";
  gpuLabel?: string;
  onConfigureApp?: () => void;
  onManageDependencies?: () => void;
  onConfigureLLM?: () => void;
  onConfigureWhisper?: () => void;
  onConfigureFFmpeg?: () => void;
  onShowHowToUse?: () => void;
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
  onConfigureApp,
  onManageDependencies,
  onConfigureLLM,
  onConfigureWhisper,
  onConfigureFFmpeg,
  onShowHowToUse,
  onOpenSettings,
  actions,
  className,
}: StudioTopbarProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  // Fechar menu ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setIsSettingsOpen(false);
      }
    }
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSettingsOpen]);

  const tabs: { id: StudioTab; label: string }[] = [
    { id: "workspace", label: "Workspace" },
    { id: "render-queue", label: "Fila de Render" },
    { id: "completed", label: "Concluidos" },
  ];

  const handleSettingsClick = () => {
    // Se tiver handlers individuais, abre o menu; senao chama o onOpenSettings
    if (onConfigureApp || onManageDependencies || onConfigureLLM || onConfigureWhisper || onConfigureFFmpeg) {
      setIsSettingsOpen((prev) => !prev);
    } else if (onOpenSettings) {
      onOpenSettings();
    }
  };

  return (
    <header
      className={cn(
        "relative z-40 flex h-14 w-full select-none items-center justify-between border-b border-white/[0.08] bg-[#09090b]/90 px-[clamp(0.75rem,2cqi,1.25rem)] backdrop-blur-2xl @container/topbar",
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

      {/* Direita: Indicador de Hardware + Acoes + Menu de Configuracoes */}
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
            <span className="text-xs font-mono font-medium tracking-wider text-zinc-300">
              {gpuLabel}
            </span>
          </div>
        </div>

        {/* Botao de Configuracoes com Dropdown Popover */}
        <div className="relative" ref={settingsMenuRef}>
          <button
            type="button"
            onClick={handleSettingsClick}
            title="Configuracoes do Sistema"
            aria-label="Abrir configuracoes do sistema"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 active:scale-95 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
              isSettingsOpen
                ? "border-white/30 bg-white/[0.14] text-white"
                : "border-white/[0.08] bg-white/[0.04] text-text-2 hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white",
            )}
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

          {/* Menu Popover Liquid Glass Opaco e Nítido */}
          {isSettingsOpen && (
            <div
              className="absolute right-0 top-11 w-[380px] rounded-2xl border border-white/20 p-3.5 shadow-[0_24px_70px_rgba(0,0,0,0.95),inset_0_1px_0_0_rgba(255,255,255,0.15)] z-50 animate-in fade-in zoom-in-95 duration-150 select-none"
              style={{ backgroundColor: "rgba(14, 14, 18, 0.98)" }}
            >
              <div className="px-3 py-2.5 border-b border-white/[0.08] mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">Configurações do Sistema</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Ajustes globais do pipeline ClipFlow</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Fechar menu de configurações"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="py-1 space-y-1.5">
                {/* 1. Configurar Aplicacao */}
                {onConfigureApp && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onConfigureApp();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Configurar Aplicação</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Pastas de mídia e resolução</p>
                    </div>
                  </button>
                )}

                {/* 2. Gerenciar Dependencias */}
                {onManageDependencies && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onManageDependencies();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Gerenciar Dependências</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Python, Whisper, FFmpeg, CUDA</p>
                    </div>
                  </button>
                )}

                {/* 3. Configurar LLM */}
                {onConfigureLLM && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onConfigureLLM();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" />
                        <line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" />
                        <line x1="15" y1="20" x2="15" y2="23" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Configurar LLM (IA)</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Modelos Ollama e prompts</p>
                    </div>
                  </button>
                )}

                {/* 4. Configurar Whisper */}
                {onConfigureWhisper && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onConfigureWhisper();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Configurar Whisper</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Modelos e aceleração GPU</p>
                    </div>
                  </button>
                )}

                {/* 5. Configurar FFmpeg */}
                {onConfigureFFmpeg && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onConfigureFFmpeg();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Configurar FFmpeg</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Codecs e presets de render</p>
                    </div>
                  </button>
                )}

                {/* 6. Como Utilizar */}
                {onShowHowToUse && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onShowHowToUse();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left bg-white/[0.02] hover:bg-white/[0.08] border border-white/[0.04] hover:border-white/15 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 group-hover:text-white group-hover:bg-white/10 flex-shrink-0 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-white transition-colors">Como Utilizar</p>
                      <p className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">Guia passo a passo do fluxo</p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
