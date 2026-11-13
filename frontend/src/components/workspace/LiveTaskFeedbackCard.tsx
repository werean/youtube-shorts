import { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import { GlassButton } from "../ui/glass";

export interface LiveTaskFeedbackCardProps {
  status: string;
  progress: number;
  etaSeconds?: number | null;
  currentMessage?: string;
  logs: string[];
  onCancel?: () => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  className?: string;
}

const FRIENDLY_STATUS: Record<string, { label: string; step: string; color: string }> = {
  DOWNLOADING: {
    label: "Baixando vídeo fonte (yt-dlp)",
    step: "Etapa 1/5",
    color: "from-blue-500 to-cyan-400",
  },
  TRANSCRIBING: {
    label: "Transcrevendo áudio com faster-whisper",
    step: "Etapa 2/5",
    color: "from-indigo-500 to-blue-400",
  },
  BUILDING_BLOCKS: {
    label: "Construindo blocos semânticos e prosódicos",
    step: "Etapa 3/5",
    color: "from-purple-500 to-indigo-400",
  },
  BUILDING_TOPICS: {
    label: "Segmentando tópicos contextuais (TextTiling)",
    step: "Etapa 4/5",
    color: "from-amber-500 to-orange-400",
  },
  ANALYZING: {
    label: "Minerando cortes virais via IA (LLM)",
    step: "Etapa 5/5",
    color: "from-pink-500 to-rose-400",
  },
  RENDERING: {
    label: "Renderizando Shorts verticais 9:16 (NVENC)",
    step: "Exportação",
    color: "from-emerald-500 to-teal-400",
  },
};

function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "";
  if (seconds < 60) return `~${Math.round(seconds)}s restante`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `~${mins}m ${secs}s restante`;
}

export function LiveTaskFeedbackCard({
  status,
  progress,
  etaSeconds,
  currentMessage,
  logs,
  onCancel,
  isExpanded = true,
  onToggleExpanded,
  className,
}: LiveTaskFeedbackCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(isExpanded);
  const [copied, setCopied] = useState(false);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  const isControlled = onToggleExpanded !== undefined;
  const expanded = isControlled ? isExpanded : internalExpanded;

  const toggle = () => {
    if (isControlled) {
      onToggleExpanded?.();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const normalizedStatus = String(status || "").replace(/^JobStatus\./i, "").toUpperCase();
  const info = FRIENDLY_STATUS[normalizedStatus] || {
    label: normalizedStatus ? `Processando (${normalizedStatus})` : "Processando tarefa...",
    step: "Ativo",
    color: "from-blue-500 to-indigo-500",
  };

  // Auto-scroll para o final dos logs
  useEffect(() => {
    if (expanded && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  const handleCopyLogs = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border border-white/[0.1] bg-[#0c0c0e]/85 shadow-[0_16px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-all duration-300 overflow-hidden",
        className,
      )}
    >
      {/* Barra de Progresso no Topo do Card */}
      <div className="h-1.5 w-full bg-white/[0.06] overflow-hidden">
        <div
          className={cn("h-full bg-gradient-to-r transition-all duration-300 ease-out", info.color)}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      <div className="p-4 space-y-3.5">
        {/* Linha Superior: Badge com Ponto Pulsante, Status, ETA e Cancelar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Ponto Pulsante de Atividade */}
            <div className="relative flex items-center justify-center w-3 h-3 flex-none">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            </div>

            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-semibold text-xs text-white tracking-wide">
                {info.label}
              </span>
              <span className="text-[10px] font-sans font-medium uppercase px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-zinc-400">
                {info.step}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-none">
            {/* ETA Badge */}
            {etaSeconds !== null && etaSeconds !== undefined && etaSeconds > 0 && (
              <span className="text-xs font-sans font-medium text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-md border border-cyan-500/30">
                {formatEta(etaSeconds)}
              </span>
            )}

            {/* Porcentagem */}
            <span className="font-sans font-bold tabular-nums text-sm text-white min-w-[2.75rem] text-right">
              {progress.toFixed(0)}%
            </span>

            {/* Botão de Cancelar Operação */}
            {onCancel && (
              <GlassButton
                variant="danger"
                size="sm"
                onClick={onCancel}
                leadingIcon={
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                }
              >
                Cancelar
              </GlassButton>
            )}
          </div>
        </div>

        {/* Mensagem Atual da Tarefa */}
        {currentMessage && (
          <p className="text-xs text-zinc-300 font-sans bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 truncate">
            {currentMessage}
          </p>
        )}

        {/* Cabeçalho do Mini Terminal Colapsável */}
        <div className="pt-1">
          <div
            onClick={toggle}
            className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] cursor-pointer transition-colors select-none"
          >
            <div className="flex items-center gap-2">
              <svg
                className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span className="text-xs font-medium text-zinc-400">
                Logs de Execução {logs.length > 0 && `(${logs.length})`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  className="text-[11px] text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                >
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              )}
              <svg
                className={cn(
                  "w-3.5 h-3.5 text-zinc-400 transition-transform duration-200",
                  expanded ? "rotate-180" : "rotate-0",
                )}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {/* Mini Terminal / Console Translúcido */}
          {expanded && (
            <div
              ref={terminalScrollRef}
              className="mt-2 p-3 max-h-44 overflow-y-auto rounded-xl bg-black/60 border border-white/[0.06] font-mono text-[11px] space-y-1 scrollbar-thin scrollbar-thumb-white/10 select-text"
            >
              {logs.length === 0 ? (
                <div className="text-zinc-600 italic py-2 text-center text-xs">
                  Aguardando primeiras mensagens do backend...
                </div>
              ) : (
                logs.map((line, idx) => {
                  const isError = /erro|error|fail|falha|exception/i.test(line);
                  const isSuccess = /sucesso|success|conclu[ií]d/i.test(line);
                  return (
                    <div
                      key={idx}
                      className={cn(
                        "leading-relaxed break-all",
                        isError ? "text-rose-400 font-semibold" : isSuccess ? "text-emerald-300" : "text-zinc-300",
                      )}
                    >
                      <span className="text-zinc-600 select-none mr-2 text-[10px]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span>{line}</span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
