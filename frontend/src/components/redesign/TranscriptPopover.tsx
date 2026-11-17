import { useState } from "react";
import { Check, Copy, DownloadSimple, Eye, EyeSlash, X } from "@phosphor-icons/react";
import type { Segment } from "../../types";
import { formatShortTime } from "./presets";

interface TranscriptPopoverProps {
  open: boolean;
  transcriptionText: string;
  segments: Segment[];
  blocks: Record<string, unknown>[];
  showDiscardedCuts: boolean;
  discardedCount: number;
  onToggleShowDiscarded: () => void;
  onSeekTo: (seconds: number) => void;
  onClose: () => void;
}

export function TranscriptPopover({
  open,
  transcriptionText,
  segments,
  blocks,
  showDiscardedCuts,
  discardedCount,
  onToggleShowDiscarded,
  onSeekTo,
  onClose,
}: TranscriptPopoverProps) {
  const [tab, setTab] = useState<"transcript" | "blocks">("transcript");
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const plainText =
    segments.length > 0
      ? segments.map((s) => `[${formatShortTime(s.start)}] ${s.text}`).join("\n")
      : transcriptionText;

  const handleCopy = async () => {
    const textToCopy =
      tab === "transcript"
        ? plainText
        : JSON.stringify(blocks, null, 2);
    if (!textToCopy) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const handleDownload = () => {
    const content = tab === "transcript" ? plainText : JSON.stringify(blocks, null, 2);
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tab === "transcript" ? "transcricao.txt" : "blocos.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-label="Transcrição"
      className="fixed z-popover bottom-[calc(var(--dock-h)+28px)] left-4 w-[min(560px,90vw)] max-h-[60vh] flex flex-col rounded-panel glass--strong overflow-hidden"
    >
      {/* Cabeçalho com abas e ações */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("transcript")}
            className={[
              "h-7 px-3 rounded-pill text-sm font-medium transition-colors duration-fast",
              tab === "transcript"
                ? "bg-glass-active text-text-1"
                : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
            ].join(" ")}
          >
            Transcrição
          </button>
          <button
            type="button"
            onClick={() => setTab("blocks")}
            className={[
              "h-7 px-3 rounded-pill text-sm font-medium transition-colors duration-fast",
              tab === "blocks"
                ? "bg-glass-active text-text-1"
                : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
            ].join(" ")}
          >
            Blocos
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {discardedCount > 0 && (
            <button
              type="button"
              onClick={onToggleShowDiscarded}
              className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-xs text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast whitespace-nowrap shrink-0"
            >
              {showDiscardedCuts ? <EyeSlash size={13} /> : <Eye size={13} />}
              <span>
                {showDiscardedCuts
                  ? "Ocultar descartados"
                  : `Mostrar descartados (${discardedCount})`}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={!plainText && blocks.length === 0}
            className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1 hover:bg-glass-hover disabled:opacity-40 transition-colors duration-fast"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!plainText && blocks.length === 0}
            className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-sm text-text-2 hover:text-text-1 hover:bg-glass-hover disabled:opacity-40 transition-colors duration-fast"
          >
            <DownloadSimple size={14} />
            <span>Baixar</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar transcrição"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto arc-scroll p-4 space-y-2 text-base">
        {tab === "transcript" ? (
          segments.length > 0 ? (
            segments.map((seg) => (
              <button
                key={seg.segment_id}
                type="button"
                onClick={() => onSeekTo(seg.start)}
                className="w-full flex items-start gap-3 px-2.5 py-1.5 rounded-item text-left hover:bg-glass-hover transition-colors duration-fast"
              >
                <span className="text-xs text-text-3 tabular-nums pt-0.5 shrink-0">
                  {formatShortTime(seg.start)}
                </span>
                <span className="text-text-1 leading-relaxed">{seg.text}</span>
              </button>
            ))
          ) : transcriptionText ? (
            <p className="text-text-1 whitespace-pre-wrap leading-relaxed">{transcriptionText}</p>
          ) : (
            <p className="text-sm text-text-3 py-6 text-center">
              Nenhuma transcrição disponível para este vídeo ainda.
            </p>
          )
        ) : blocks.length > 0 ? (
          blocks.map((block, index) => {
            const start = Number(block.start ?? 0);
            const text = String(block.text ?? block.summary ?? "");
            return (
              <button
                key={String(block.block_id ?? index)}
                type="button"
                onClick={() => onSeekTo(start)}
                className="w-full flex flex-col gap-1 px-3 py-2 rounded-item bg-white/[0.03] hover:bg-glass-hover text-left transition-colors duration-fast"
              >
                <span className="text-xs text-accent-soft tabular-nums">
                  {formatShortTime(start)}
                </span>
                <span className="text-sm text-text-1 leading-relaxed">{text}</span>
              </button>
            );
          })
        ) : (
          <p className="text-sm text-text-3 py-6 text-center">
            Nenhum bloco semântico gerado ainda.
          </p>
        )}
      </div>
    </div>
  );
}
