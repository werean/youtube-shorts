import React, { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "../../lib/utils";
import { GlassButton } from "../shared";

export type LogFilterCategory = "all" | "ingest" | "transcription" | "analysis" | "render";

export interface TerminalLogsViewProps {
  logs: string[];
  activeTask?: string | null;
  isProcessing?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  onClearLogs?: () => void;
  className?: string;
}

export function TerminalLogsView({
  logs,
  activeTask,
  isProcessing = false,
  isExpanded = true,
  onToggleExpanded,
  onClearLogs,
  className,
}: TerminalLogsViewProps) {
  const [selectedFilter, setSelectedFilter] = useState<LogFilterCategory>("all");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll para a última linha de log
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  const filteredLogs = useMemo(() => {
    if (selectedFilter === "all") return logs;
    return logs.filter((line) => {
      const lower = line.toLowerCase();
      if (selectedFilter === "ingest") return lower.includes("ingest") || lower.includes("download");
      if (selectedFilter === "transcription") return lower.includes("transcription") || lower.includes("whisper");
      if (selectedFilter === "analysis") return lower.includes("analysis") || lower.includes("block") || lower.includes("topic") || lower.includes("llm");
      if (selectedFilter === "render") return lower.includes("render") || lower.includes("ffmpeg") || lower.includes("nvenc");
      return true;
    });
  }, [logs, selectedFilter]);

  const handleCopyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const lastLogLine = logs.length > 0 ? logs[logs.length - 1] : "";

  const renderLogLine = (line: string, index: number) => {
    const isError = /erro|error|exception|fail|failed|✗/i.test(line);
    const isSuccess = /sucesso|success|ready|conclu[ií]d/i.test(line);

    // Coloriza os prefixos de log
    let prefixColor = "text-zinc-400";
    if (/\[ingest\]|\[download\]/i.test(line)) prefixColor = "text-cyan-400";
    else if (/\[transcription\]|\[whisper\]/i.test(line)) prefixColor = "text-indigo-400";
    else if (/\[analysis\]|\[blocks\]|\[topics\]/i.test(line)) prefixColor = "text-amber-400";
    else if (/\[render\]|\[ffmpeg\]|\[nvenc\]/i.test(line)) prefixColor = "text-emerald-400";
    else if (/\[orchestrator\]/i.test(line)) prefixColor = "text-blue-400";

    return (
      <div
        key={index}
        className={cn(
          "leading-relaxed font-mono text-[11px] select-text break-all",
          isError ? "text-rose-400 font-semibold" : isSuccess ? "text-emerald-300" : "text-zinc-300",
        )}
      >
        <span className="text-zinc-600 select-none mr-2 font-mono text-[10px]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className={prefixColor}>{line}</span>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c0e]/80 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300",
        isExpanded ? "p-3" : "p-3",
        className,
      )}
    >
      {/* Header Compacto do Terminal com Controles e Toggle */}
      <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.08] select-none gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className="w-4 h-4 text-cyan-400 flex-shrink-0"
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
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 font-sans">
            Terminal de Execução
          </span>

          {isProcessing ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-xs font-sans font-medium text-blue-300 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
              Executando {activeTask ? `• ${activeTask}` : ""}
            </span>
          ) : logs.length > 0 ? (
            <span className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10 text-xs font-sans font-medium text-zinc-400">
              {logs.length} linhas
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full bg-white/[0.03] border border-white/10 text-xs font-sans font-medium text-zinc-400">
              Ocioso
            </span>
          )}

          {!isExpanded && lastLogLine && (
            <span className="hidden sm:inline-block text-xs font-sans text-zinc-400 truncate max-w-[280px]">
              • {lastLogLine}
            </span>
          )}
        </div>

        {/* Controles: Filtros, Limpar, Copiar e Toggle de Recolher */}
        <div className="flex items-center gap-1.5 ml-auto">
          {isExpanded && (
            <>
              {/* Filtros em Pílulas */}
              <div className="hidden md:flex items-center bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.06] text-xs font-sans">
                {(["all", "ingest", "transcription", "analysis", "render"] as LogFilterCategory[]).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedFilter(cat)}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-colors font-medium",
                      selectedFilter === cat
                        ? "bg-white/15 text-white font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200",
                    )}
                  >
                    {cat === "all" ? "Todos" : cat === "ingest" ? "Download" : cat === "transcription" ? "Whisper" : cat === "analysis" ? "Cortes" : "Render"}
                  </button>
                ))}
              </div>

              {logs.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                    title={copied ? "Copiado!" : "Copiar todos os logs"}
                  >
                    {copied ? (
                      <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>

                  {onClearLogs && (
                    <button
                      type="button"
                      onClick={onClearLogs}
                      className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                      title="Limpar logs"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Botão de Expandir / Recolher com Seta Animada */}
          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              aria-label={isExpanded ? "Ocultar logs do terminal" : "Exibir logs do terminal"}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-sans font-medium text-zinc-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] transition-all"
            >
              <span>{isExpanded ? "Ocultar" : "Exibir"}</span>
              <svg
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-300 ease-out",
                  !isExpanded ? "rotate-180" : "rotate-0",
                )}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo Expansível do Terminal */}
      {isExpanded && (
        <div className="mt-2.5 flex flex-col min-h-0">
          <div
            ref={scrollRef}
            className="h-32 sm:h-40 overflow-y-auto rounded-xl bg-black/85 border border-white/[0.06] p-3 font-mono space-y-1 shadow-inner select-text custom-scrollbar"
          >
            {filteredLogs.length > 0 ? (
              <>
                {filteredLogs.map((line, idx) => renderLogLine(line, idx))}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-zinc-500 font-mono text-[11px] pt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    <span>Aguardando próxima saída do processo...</span>
                    <span className="inline-block w-1.5 h-3 bg-blue-400 animate-pulse" />
                  </div>
                )}
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 space-y-1">
                <p className="text-xs font-mono">
                  {isProcessing
                    ? "Iniciando captura de telemetria do processo..."
                    : "Nenhum log disponível. Inicie uma operação para acompanhar a telemetria em tempo real."}
                </p>
                <p className="text-[10px] text-zinc-600 font-mono">
                  Logs de yt-dlp, faster-whisper GPU, TextTiling e FFmpeg NVENC serão transmitidos aqui.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
