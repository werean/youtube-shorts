import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { getJobLogs } from "../../api/logs";

const POLL_INTERVAL_MS = 1500;
const STICK_THRESHOLD_PX = 24;

interface TerminalPanelProps {
  jobId: string | null;
  /** Há tarefa viva para este vídeo agora (controla o polling). */
  isProcessing: boolean;
  onClose: () => void;
}

/**
 * Painel de logs em tempo real do vídeo selecionado (todas as etapas, em ordem
 * cronológica). Só consulta o backend enquanto está aberto; durante o
 * processamento a cada 1,5 s; ao terminar, a mudança de estado dispara uma leitura final
 * que mantém as últimas linhas (inclusive o erro).
 */
export function TerminalPanel({ jobId, isProcessing, onClose }: TerminalPanelProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const fetchLogs = useCallback(async (id: string, isCancelled: () => boolean) => {
    try {
      const result = await getJobLogs(id, "all");
      if (!isCancelled() && Array.isArray(result.logs)) {
        setLines(result.logs);
      }
    } catch {
      // falha transitória: mantém as linhas atuais
    } finally {
      if (!isCancelled()) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    setLines([]);
    setLoaded(false);
    stickToBottomRef.current = true;
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      setLines([]);
      return;
    }
    let cancelled = false;
    const isCancelled = () => cancelled;
    void fetchLogs(jobId, isCancelled);
    if (!isProcessing) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(() => {
      void fetchLogs(jobId, isCancelled);
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, isProcessing, fetchLogs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
  };

  return (
    <div
      role="dialog"
      aria-label="Terminal"
      className="absolute bottom-[calc(100%+8px)] right-0 z-popover w-[min(640px,calc(100vw-24px))] rounded-card glass--strong shadow-pop flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-line shrink-0">
        <span className="text-sm font-medium text-text-1">Terminal</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar terminal"
          className="grid h-6 w-6 place-items-center rounded-pill text-text-3 hover:bg-glass-active hover:text-text-1 transition-colors duration-fast"
        >
          <X size={14} weight="regular" />
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="arc-scroll h-64 overflow-y-auto px-3 py-2 font-mono text-xs text-text-2 select-text"
      >
        {lines.length === 0 ? (
          <div className="h-full grid place-items-center text-text-3">
            {!jobId
              ? "Selecione um vídeo para ver os logs."
              : !loaded
                ? "Carregando…"
                : isProcessing
                  ? "Aguardando as primeiras linhas…"
                  : "Nenhum processamento em andamento."}
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words leading-relaxed">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
