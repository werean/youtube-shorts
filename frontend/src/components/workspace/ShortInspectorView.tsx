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
        "flex h-full w-[310px] flex-shrink-0 flex-col border-l border-white/[0.08] bg-[#0c0c0e]/80 backdrop-blur-2xl select-none",
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

        {cut ? (
          <span className="rounded-md bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[10px] font-mono text-amber-300">
            {formatTimestamp(duration)}
          </span>
        ) : (
          <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5 text-[10px] font-mono text-zinc-500">
            Aguardando
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
        {/* Titulo do Trecho */}
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
            Titulo do Trecho
          </span>
          <p className="text-body-sm font-medium text-text-1 line-clamp-2">
            {cut ? cut.title || "Corte sem titulo especificado" : "Nenhum corte selecionado"}
          </p>
        </div>

        {/* Simulador Vertical 9:16 estilo Smartphone */}
        <div className="relative mx-auto w-full max-w-[210px] aspect-[9/16] overflow-hidden rounded-[26px] border border-white/20 bg-black shadow-[0_16px_40px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.1)] flex flex-col justify-between">
          {/* Dynamic Island no topo */}
          <div className="relative z-20 mx-auto mt-2 h-4 w-20 rounded-full bg-black/90 border border-white/[0.06] flex items-center justify-center shadow-md">
            <div className="h-2 w-2 rounded-full bg-zinc-900 border border-zinc-700 mr-2" />
            <div className={cn("h-1.5 w-1.5 rounded-full", cut ? "bg-emerald-500/80 shadow-[0_0_4px_rgba(16,185,129,0.8)]" : "bg-zinc-700")} />
          </div>

          {/* Viewport de video ou preview recortado */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-zinc-950">
            {cut && videoSrc ? (
              <video
                src={`${videoSrc}#t=${cut.start},${cut.end}`}
                className="h-full w-full object-cover opacity-85"
                muted
                loop
                playsInline
                autoPlay
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-text-3 p-4 text-center">
                <div className="w-10 h-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center">
                  <svg
                    className="h-5 w-5 stroke-[1.5]"
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
                <span className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400">
                  Pre-visualizacao 9:16
                </span>
                <p className="text-[10px] text-zinc-500 leading-tight">
                  Selecione um corte na linha do tempo para carregar o enquadramento
                </p>
              </div>
            )}
          </div>

          {/* Legenda de Vidro Fosco na Base do Simulador */}
          <div className="relative z-20 m-2.5 rounded-xl border border-white/10 bg-black/60 p-2.5 backdrop-blur-md shadow-lg">
            <p className="line-clamp-2 text-center font-sans text-[11px] font-medium leading-snug text-white/90 drop-shadow">
              {cut?.subtitle || cut?.title || "Legendas dinamicas posicionadas para shorts"}
            </p>
          </div>
        </div>

        {/* Painel de Metadados e Ajuste Fino */}
        <div className="space-y-3 pt-2">
          {/* Pontos de Corte (Inicio e Fim) */}
          <div className="grid grid-cols-2 gap-2">
            {/* Inicio */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
                Inicio
              </span>
              <span className="font-mono text-body-sm font-semibold text-white">
                {formatTimestamp(cut?.start || 0)}
              </span>

              {/* Botoes de ajuste fino */}
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  disabled={!cut}
                  onClick={() => handleAdjustStartDelta(-1)}
                  className="flex-1 rounded bg-white/[0.06] py-1 text-center font-mono text-[10px] text-text-2 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Antecipar 1 segundo"
                >
                  -1s
                </button>
                <button
                  type="button"
                  disabled={!cut}
                  onClick={() => handleAdjustStartDelta(1)}
                  className="flex-1 rounded bg-white/[0.06] py-1 text-center font-mono text-[10px] text-text-2 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Adiantar 1 segundo"
                >
                  +1s
                </button>
              </div>
            </div>

            {/* Fim */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
                Fim
              </span>
              <span className="font-mono text-body-sm font-semibold text-white">
                {formatTimestamp(cut?.end || 0)}
              </span>

              {/* Botoes de ajuste fino */}
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  disabled={!cut}
                  onClick={() => handleAdjustEndDelta(-1)}
                  className="flex-1 rounded bg-white/[0.06] py-1 text-center font-mono text-[10px] text-text-2 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Reduzir 1 segundo"
                >
                  -1s
                </button>
                <button
                  type="button"
                  disabled={!cut}
                  onClick={() => handleAdjustEndDelta(1)}
                  className="flex-1 rounded bg-white/[0.06] py-1 text-center font-mono text-[10px] text-text-2 hover:bg-white/[0.12] hover:text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Estender 1 segundo"
                >
                  +1s
                </button>
              </div>
            </div>
          </div>

          {/* Score Viral IA (se presente) */}
          {cut?.score !== undefined && (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-2.5">
              <span className="text-[11px] font-medium text-text-2">Potencial de Retencao</span>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-16 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400"
                    style={{ width: `${Math.min(100, Math.max(0, cut.score * 10))}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-semibold text-white">
                  {cut.score.toFixed(1)}/10
                </span>
              </div>
            </div>
          )}

          {/* Botoes de Acao Principais */}
          <div className="space-y-2 pt-2">
            <GlassButton
              variant="primary"
              fullWidth
              loading={isRendering}
              disabled={!cut || isRendering}
              onClick={() => cut && onRenderShort?.(cut)}
              className="shadow-[0_4px_20px_rgba(255,255,255,0.18)] hover:shadow-[0_4px_28px_rgba(255,255,255,0.28)]"
              icon={
                <svg
                  className="h-4 w-4 mr-1.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              }
            >
              {isRendering ? "Renderizando Short..." : "Renderizar Short 9:16"}
            </GlassButton>

            {cut && onDiscardCut && (
              <GlassButton
                variant="danger"
                size="sm"
                fullWidth
                onClick={() => onDiscardCut(cut.cut_id)}
                icon={
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
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                }
              >
                Descartar Corte
              </GlassButton>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
