import { useState } from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { GlassButton } from "../ui/glass";
import type { Cut } from "../../types";

export interface ShortInspectorViewProps {
  cut?: Cut | null;
  videoSrc?: string;
  isRendering?: boolean;
  onAdjustStart?: (newStart: number) => void;
  onAdjustEnd?: (newEnd: number) => void;
  onRenderShort?: (cut: Cut) => void;
  onDiscardCut?: (cutId: string) => void;
  className?: string;
}

export function ShortInspectorView({
  cut,
  videoSrc,
  isRendering = false,
  onAdjustStart,
  onAdjustEnd,
  onRenderShort,
  onDiscardCut,
  className,
}: ShortInspectorViewProps) {
  // Calculo de duracao do corte
  const duration = cut ? Math.max(0, cut.end - cut.start) : 0;

  const handleAdjustStartDelta = (delta: number) => {
    if (!cut || !onAdjustStart) return;
    const newStart = Math.max(0, Math.min(cut.start + delta, cut.end - 1));
    onAdjustStart(newStart);
  };

  const handleAdjustEndDelta = (delta: number) => {
    if (!cut || !onAdjustEnd) return;
    const newEnd = Math.max(cut.start + 1, cut.end + delta);
    onAdjustEnd(newEnd);
  };

  return (
    <aside
      className={cn(
        "flex h-full w-[310px] flex-shrink-0 flex-col border-l border-white/[0.08] bg-[#0c0c0e]/70 backdrop-blur-xl select-none",
        "shadow-[inset_1px_0_0_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      {/* Cabecalho do Inspetor */}
      <div className="flex items-center justify-between p-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Inspetor de Short
          </span>
          <span className="font-mono text-[10px] text-text-3">9:16</span>
        </div>

        {cut && (
          <span className="rounded-md bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[10px] font-mono text-amber-300">
            {formatTimestamp(duration)}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
        {!cut ? (
          <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-6 text-center text-text-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02] mb-3">
              <svg
                className="h-6 w-6 stroke-[1.5]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="5" y="2" width="14" height="20" rx="3" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            </div>
            <p className="text-body font-medium text-text-2">Nenhum corte selecionado</p>
            <p className="mt-1 text-caption text-text-3">
              Selecione um corte gerado pela IA ou crie um trecho na transcricao para inspecionar e renderizar.
            </p>
          </div>
        ) : (
          <>
            {/* Titulo do Corte */}
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
                Titulo do Trecho
              </span>
              <p className="text-body-sm font-medium text-text-1 line-clamp-2">
                {cut.title || "Corte sem titulo especificado"}
              </p>
            </div>

            {/* Simulador Vertical 9:16 estilo iPhone */}
            <div className="relative mx-auto w-full max-w-[210px] aspect-[9/16] overflow-hidden rounded-[26px] border border-white/20 bg-black shadow-[0_16px_40px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.1)] flex flex-col justify-between">
              {/* Dynamic Island no topo */}
              <div className="relative z-20 mx-auto mt-2 h-4 w-20 rounded-full bg-black/90 border border-white/[0.06] flex items-center justify-center shadow-md">
                <div className="h-2 w-2 rounded-full bg-zinc-900 border border-zinc-700 mr-2" />
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/80 shadow-[0_0_4px_rgba(16,185,129,0.8)]" />
              </div>

              {/* Viewport de video ou preview recortado */}
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-zinc-950">
                {videoSrc ? (
                  <video
                    src={`${videoSrc}#t=${cut.start},${cut.end}`}
                    className="h-full w-full object-cover opacity-85"
                    muted
                    loop
                    playsInline
                    autoPlay
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-text-3">
                    <svg
                      className="h-8 w-8 stroke-[1.2]"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider">Preview 9:16</span>
                  </div>
                )}
              </div>

              {/* Legenda de Vidro Fosco na Base do Simulador */}
              <div className="relative z-20 m-2.5 rounded-xl border border-white/10 bg-black/60 p-2.5 backdrop-blur-md shadow-lg">
                <p className="line-clamp-2 text-center font-sans text-[11px] font-medium leading-snug text-white/90 drop-shadow">
                  {cut.title || "Previa de legenda dinamica gerada automaticamente"}
                </p>
              </div>

              {/* Barra inferior / Home Bar estilo iOS */}
              <div className="relative z-20 mx-auto mb-1.5 h-1 w-24 rounded-full bg-white/40" />
            </div>

            {/* Painel de Ajuste Fino de Timestamps */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 space-y-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3 block">
                Ajuste Fino de Timestamps
              </span>

              {/* Ajuste de Inicio */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm text-text-2 font-medium w-12">Inicio</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustStartDelta(-1)}
                    title="Diminuir 1 segundo do inicio"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[11px] font-mono text-text-2 hover:bg-white/[0.08] hover:text-white transition-colors"
                  >
                    -1s
                  </button>
                  <span className="min-w-[58px] text-center rounded-lg border border-white/[0.08] bg-black/40 py-1 font-mono text-body-sm font-semibold text-text-1">
                    {formatTimestamp(cut.start)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustStartDelta(1)}
                    title="Aumentar 1 segundo do inicio"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[11px] font-mono text-text-2 hover:bg-white/[0.08] hover:text-white transition-colors"
                  >
                    +1s
                  </button>
                </div>
              </div>

              {/* Ajuste de Fim */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm text-text-2 font-medium w-12">Fim</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAdjustEndDelta(-1)}
                    title="Diminuir 1 segundo do fim"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[11px] font-mono text-text-2 hover:bg-white/[0.08] hover:text-white transition-colors"
                  >
                    -1s
                  </button>
                  <span className="min-w-[58px] text-center rounded-lg border border-white/[0.08] bg-black/40 py-1 font-mono text-body-sm font-semibold text-text-1">
                    {formatTimestamp(cut.end)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAdjustEndDelta(1)}
                    title="Aumentar 1 segundo do fim"
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[11px] font-mono text-text-2 hover:bg-white/[0.08] hover:text-white transition-colors"
                  >
                    +1s
                  </button>
                </div>
              </div>
            </div>

            {/* Acoes de Renderizacao e Descarte */}
            <div className="space-y-2 pt-1">
              {/* Botao Principal Destacado: Renderizar Short com duracao */}
              <GlassButton
                variant="primary"
                size="md"
                disabled={isRendering}
                onClick={() => onRenderShort?.(cut)}
                className="w-full justify-center shadow-[0_0_25px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)]"
                icon={
                  isRendering ? (
                    <div className="h-3.5 w-3.5 mr-1 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  ) : (
                    <svg
                      className="h-3.5 w-3.5 mr-1"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                      <line x1="7" y1="2" x2="7" y2="22" />
                      <line x1="17" y1="2" x2="17" y2="22" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <line x1="2" y1="7" x2="7" y2="7" />
                      <line x1="2" y1="17" x2="7" y2="17" />
                      <line x1="17" y1="17" x2="22" y2="17" />
                      <line x1="17" y1="7" x2="22" y2="7" />
                    </svg>
                  )
                }
              >
                {isRendering
                  ? "Renderizando..."
                  : `Renderizar Short (${formatTimestamp(duration)})`}
              </GlassButton>

              {/* Botao Secundario: Descartar Corte */}
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => onDiscardCut?.(cut.cut_id)}
                className="w-full justify-center text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                icon={
                  <svg
                    className="h-3.5 w-3.5 mr-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                }
              >
                Descartar Corte
              </GlassButton>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
