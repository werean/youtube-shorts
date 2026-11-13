import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { GlassButton, GlassCard, GlassBadge } from "../ui/glass";
import type { Cut } from "../../types";
import { ShortPreviewModal } from "./ShortPreviewModal";

export interface ShortInspectorViewProps {
  cut?: Cut | null;
  videoSrc?: string;
  isRendering?: boolean;
  onAdjustStart?: (newStart: number) => void;
  onAdjustEnd?: (newEnd: number) => void;
  onRenderShort?: (cut: Cut) => void;
  onDiscardCut?: (cutId: string) => void;
  onApproveCut?: (cutId: string) => void;
  onRejectCut?: (cutId: string) => void;
  onOpenEditCutDialog?: (cut: Cut) => void;
  cuts?: Cut[];
  renderOutputs?: string[];
  renderTitlesByFileName?: Record<string, string>;
  buildRenderUrl?: (renderPath: string) => string;
  readOnly?: boolean;
  onSelectCut?: (cutId: string) => void;
  onApproveAllCuts?: () => void;
  onRejectAllCuts?: () => void;
  onRenderApprovedCuts?: () => void;
  className?: string;
}

function isCutApproved(cut: Cut): boolean {
  return cut.approved === true || cut.status === "approved";
}

function isCutRejected(cut: Cut): boolean {
  return cut.rejected === true || cut.status === "rejected";
}

function formatTimestampForFilename(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

function buildCutFilename(cut: Cut): string {
  return `${formatTimestampForFilename(cut.start)}-${formatTimestampForFilename(cut.end)}.mp4`;
}

function extractRenderFileName(renderPath: string): string {
  const withoutQuery = renderPath.split("?")[0] ?? renderPath;
  return withoutQuery.split("/").pop() || withoutQuery;
}

export function ShortInspectorView({
  cut,
  videoSrc,
  isRendering = false,
  onAdjustStart,
  onAdjustEnd,
  onRenderShort,
  onDiscardCut,
  onApproveCut,
  onRejectCut,
  onOpenEditCutDialog,
  cuts,
  renderOutputs = [],
  renderTitlesByFileName,
  buildRenderUrl,
  readOnly = false,
  onSelectCut,
  onApproveAllCuts,
  onRejectAllCuts,
  onRenderApprovedCuts,
  className,
}: ShortInspectorViewProps) {
  const [selectedRenderPath, setSelectedRenderPath] = useState<string | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const skipResetCutIdRef = useRef<string | null>(null);
  const prevCutIdRef = useRef<string | null>(cut?.cut_id ?? null);

  // Reset invalid selectedRenderPath when renderOutputs clears or shrinks (e.g. job switch)
  useEffect(() => {
    if (selectedRenderPath && !renderOutputs.includes(selectedRenderPath)) {
      setSelectedRenderPath(null);
    }
  }, [renderOutputs, selectedRenderPath]);

  // If user switches to another cut from timeline/outside, return simulator to that cut unless triggered by clicking a rendered output
  useEffect(() => {
    const nextCutId = cut?.cut_id ?? null;
    if (nextCutId !== prevCutIdRef.current) {
      prevCutIdRef.current = nextCutId;
      if (skipResetCutIdRef.current && skipResetCutIdRef.current === nextCutId) {
        skipResetCutIdRef.current = null;
      } else {
        setSelectedRenderPath(null);
      }
    }
  }, [cut?.cut_id]);

  const cutsByFileName = useMemo(() => {
    const map = new Map<string, Cut>();
    if (!cuts) return map;
    for (const item of cuts) {
      map.set(buildCutFilename(item), item);
    }
    return map;
  }, [cuts]);

  const matchingCutRenderPath = useMemo(() => {
    if (!cut || renderOutputs.length === 0) return null;
    const expectedName = buildCutFilename(cut);
    return renderOutputs.find((path) => extractRenderFileName(path) === expectedName) ?? null;
  }, [cut, renderOutputs]);

  const resolveUrl = (path: string | null): string => {
    if (!path) return "";
    return buildRenderUrl ? buildRenderUrl(path) : path;
  };

  const selectedRenderUrl = useMemo(
    () => resolveUrl(selectedRenderPath),
    [selectedRenderPath, buildRenderUrl],
  );

  const activeRenderPath = selectedRenderPath ?? matchingCutRenderPath;
  const activeRenderUrl = useMemo(
    () => resolveUrl(activeRenderPath),
    [activeRenderPath, buildRenderUrl],
  );

  const activeRenderTitle = useMemo(() => {
    if (!activeRenderPath) return cut?.title || "Short Renderizado 9:16";
    const fileName = extractRenderFileName(activeRenderPath);
    const mappedTitle = renderTitlesByFileName?.[fileName];
    if (mappedTitle) return mappedTitle;
    const matchedCut = cutsByFileName.get(fileName);
    return matchedCut?.title || cut?.title || fileName;
  }, [activeRenderPath, renderTitlesByFileName, cutsByFileName, cut?.title]);

  useEffect(() => {
    if (!activeRenderUrl && isPreviewModalOpen) {
      setIsPreviewModalOpen(false);
    }
  }, [activeRenderUrl, isPreviewModalOpen]);

  // Curation counts
  const hasCutsList = Boolean(cuts && cuts.length > 0);
  const approvedCount = useMemo(
    () => (cuts ? cuts.filter(isCutApproved).length : 0),
    [cuts],
  );
  const rejectedCount = useMemo(
    () => (cuts ? cuts.filter(isCutRejected).length : 0),
    [cuts],
  );
  const pendingCount = useMemo(
    () => (cuts ? cuts.length - approvedCount - rejectedCount : 0),
    [cuts, approvedCount, rejectedCount],
  );

  const selectedCutApproved = cut ? isCutApproved(cut) : false;
  const selectedCutRejected = cut ? isCutRejected(cut) : false;

  // Calculo de duracao do corte
  const duration = cut ? Math.max(0, cut.end - cut.start) : 0;
  const arc = cut?.narrative_arc;

  const handleAdjustStartDelta = (delta: number) => {
    if (!cut || !onAdjustStart || readOnly) return;
    const newStart = Math.max(0, Math.min(cut.start + delta, cut.end - 1));
    onAdjustStart(newStart);
  };

  const handleAdjustEndDelta = (delta: number) => {
    if (!cut || !onAdjustEnd || readOnly) return;
    const newEnd = Math.max(cut.start + 1, cut.end + delta);
    onAdjustEnd(newEnd);
  };

  const handleSelectRenderedShort = (path: string) => {
    setSelectedRenderPath(path);
    const fileName = extractRenderFileName(path);
    const matchedCut = cutsByFileName.get(fileName);
    if (matchedCut && onSelectCut) {
      skipResetCutIdRef.current = matchedCut.cut_id;
      onSelectCut(matchedCut.cut_id);
    }
  };

  const isPlayingRenderedShort = Boolean(selectedRenderPath && selectedRenderUrl);

  return (
    <aside
      className={cn(
        "flex h-full w-[350px] flex-shrink-0 flex-col border-l border-white/[0.08] bg-[#0c0c0e]/85 backdrop-blur-2xl select-none",
        "shadow-[inset_1px_0_0_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      {/* Cabecalho do Inspetor */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.015]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Inspetor de Short
          </span>
          <span className="font-sans font-medium text-xs text-zinc-300 bg-white/[0.05] border border-white/10 px-2 py-0.5 rounded-md">
            9:16
          </span>
          {cut?.vertical_mode && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-sans font-medium text-zinc-300 uppercase">
              {cut.vertical_mode}
            </span>
          )}
        </div>

        {cut ? (
          <span className="rounded-md bg-amber-400/15 border border-amber-400/30 px-2.5 py-1 text-xs font-sans font-semibold tabular-nums text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.15)]">
            {formatTimestamp(duration)}
          </span>
        ) : (
          <span className="rounded-md bg-white/[0.05] border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-300">
            Aguardando
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-stable">
        {/* Curadoria em Lote e Lista de Cortes */}
        {hasCutsList && cuts && (
          <div className="space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                Curadoria ({cuts.length})
              </span>
              <div className="flex items-center gap-1.5 text-[10px] font-medium">
                <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-300 tabular-nums">
                  {approvedCount} aprov.
                </span>
                <span className="rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-red-300 tabular-nums">
                  {rejectedCount} recus.
                </span>
                {pendingCount > 0 && (
                  <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-amber-300 tabular-nums">
                    {pendingCount} pend.
                  </span>
                )}
              </div>
            </div>

            {/* Aceitar todos / Recusar todos */}
            {!readOnly && (
              <div className="grid grid-cols-2 gap-2">
                <GlassButton
                  variant="glass"
                  size="sm"
                  fullWidth
                  disabled={isRendering || !onApproveAllCuts}
                  onClick={onApproveAllCuts}
                  className="bg-emerald-500/10 border-emerald-500/25 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-400/40"
                >
                  Aceitar todos
                </GlassButton>
                <GlassButton
                  variant="danger"
                  size="sm"
                  fullWidth
                  disabled={isRendering || !onRejectAllCuts}
                  onClick={onRejectAllCuts}
                >
                  Recusar todos
                </GlassButton>
              </div>
            )}

            {/* Lista compacta de cortes para selecao e curadoria rapida */}
            <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
              {cuts.map((item, idx) => {
                const isSelected = cut?.cut_id === item.cut_id;
                const itemApproved = isCutApproved(item);
                const itemRejected = isCutRejected(item);

                return (
                  <div
                    key={item.cut_id}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors",
                      isSelected
                        ? "border-white/30 bg-white/[0.1]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectCut?.(item.cut_id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            itemApproved
                              ? "bg-emerald-400"
                              : itemRejected
                                ? "bg-red-400"
                                : "bg-amber-400",
                          )}
                        />
                        <span className="truncate text-xs font-medium text-zinc-100">
                          {item.title || `Corte ${idx + 1}`}
                        </span>
                      </div>
                      <span className="block pl-3.5 text-[10px] tabular-nums text-zinc-400">
                        {formatTimestamp(item.start)} – {formatTimestamp(item.end)}
                      </span>
                    </button>

                    {!readOnly && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={isRendering}
                          onClick={() => onApproveCut?.(item.cut_id)}
                          title="Aprovar corte"
                          aria-label={`Aprovar ${item.title || `Corte ${idx + 1}`}`}
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:opacity-40",
                            itemApproved
                              ? "border-emerald-400/50 bg-emerald-500/25 text-emerald-200"
                              : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-emerald-300 hover:border-emerald-500/30",
                          )}
                        >
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          disabled={isRendering}
                          onClick={() => onRejectCut?.(item.cut_id)}
                          title="Recusar corte"
                          aria-label={`Recusar ${item.title || `Corte ${idx + 1}`}`}
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:opacity-40",
                            itemRejected
                              ? "border-red-400/50 bg-red-500/25 text-red-200"
                              : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-red-300 hover:border-red-500/30",
                          )}
                        >
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Gate de Revisao + Botao Renderizar Cortes */}
            {!readOnly && (
              <div className="pt-1 border-t border-white/[0.06] space-y-2">
                {pendingCount > 0 ? (
                  <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                    Falta revisar{" "}
                    <strong className="font-semibold">{pendingCount}</strong>{" "}
                    {pendingCount === 1 ? "corte" : "cortes"}. Aprove ou recuse
                    os restantes (ou use{" "}
                    <strong className="font-semibold">Aceitar todos</strong> /{" "}
                    <strong className="font-semibold">Recusar todos</strong>)
                    para renderizar.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <GlassButton
                      variant="primary"
                      size="sm"
                      fullWidth
                      loading={isRendering}
                      disabled={isRendering || approvedCount === 0}
                      onClick={() => {
                        if (onRenderApprovedCuts) {
                          onRenderApprovedCuts();
                        } else if (cut && onRenderShort) {
                          onRenderShort(cut);
                        }
                      }}
                      className="shadow-[0_4px_20px_rgba(255,255,255,0.18)]"
                      icon={
                        <svg
                          className="h-3.5 w-3.5"
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
                      {isRendering
                        ? "Renderizando Cortes..."
                        : `Renderizar Cortes (${approvedCount})`}
                    </GlassButton>
                    {approvedCount === 0 && (
                      <p className="text-center text-[11px] text-zinc-400">
                        Nenhum corte aprovado. Aprove ao menos 1 corte para
                        renderizar.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Lista Progressiva de Shorts Renderizados (Cortes Prontos) */}
        {(renderOutputs.length > 0 || isRendering) && (
          <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                Cortes Prontos
              </span>
              <div className="flex items-center gap-2">
                {isRendering && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    Renderizando...
                  </span>
                )}
                <GlassBadge variant="score" size="sm">
                  {renderOutputs.length}
                </GlassBadge>
              </div>
            </div>

            {renderOutputs.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-zinc-400">
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span>Aguardando primeiros shorts finalizados...</span>
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-0.5">
                {renderOutputs.map((path) => {
                  const fileName = extractRenderFileName(path);
                  const matchedCut = cutsByFileName.get(fileName);
                  const displayTitle =
                    renderTitlesByFileName?.[fileName] ||
                    matchedCut?.title ||
                    fileName;
                  const isActive = selectedRenderPath === path;

                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => handleSelectRenderedShort(path)}
                      className={cn(
                        "w-full flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition-all",
                        isActive
                          ? "border-emerald-400/50 bg-emerald-500/15 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
                          : "border-white/[0.06] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">
                          {displayTitle}
                        </p>
                        <p className="truncate font-mono text-[10px] text-zinc-400">
                          {fileName}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold",
                          isActive
                            ? "bg-emerald-400/20 text-emerald-200 border border-emerald-400/30"
                            : "bg-white/[0.06] text-zinc-300 border border-white/10",
                        )}
                      >
                        {isActive ? "No player" : "Ver"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Titulo do Trecho */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Título do Trecho
            </span>
            <div className="flex items-center gap-2">
              {cut?.block_ids && cut.block_ids.length > 0 && (
                <span className="text-xs font-sans font-medium text-zinc-400">
                  {cut.block_ids.length}{" "}
                  {cut.block_ids.length === 1 ? "bloco" : "blocos"}
                </span>
              )}
              {cut && onOpenEditCutDialog && !readOnly && (
                <button
                  type="button"
                  onClick={() => onOpenEditCutDialog(cut)}
                  className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-zinc-300 hover:bg-white/[0.12] hover:text-white transition-colors"
                >
                  Editar
                </button>
              )}
            </div>
          </div>
          <p className="text-sm font-semibold text-white leading-snug line-clamp-2">
            {isPlayingRenderedShort
              ? activeRenderTitle
              : cut
                ? cut.title || "Corte sem título especificado"
                : "Nenhum corte selecionado"}
          </p>
        </div>

        {/* Simulador Vertical 9:16 + Botao "Ver vídeo real" lado a lado */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3">
            {/* Simulador Vertical 9:16 estilo Smartphone */}
            <div className="relative w-[176px] shrink-0 aspect-[9/16] overflow-hidden rounded-[26px] border border-white/20 bg-black shadow-[0_16px_40px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.1)] flex flex-col justify-between">
              {/* Dynamic Island no topo */}
              <div className="relative z-20 mx-auto mt-2 h-4 w-20 rounded-full bg-black/90 border border-white/[0.06] flex items-center justify-center shadow-md">
                <div className="h-2 w-2 rounded-full bg-zinc-900 border border-zinc-700 mr-2" />
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isPlayingRenderedShort || cut
                      ? "bg-emerald-500/80 shadow-[0_0_4px_rgba(16,185,129,0.8)]"
                      : "bg-zinc-700",
                  )}
                />
              </div>

              {/* Viewport de video ou preview recortado */}
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-zinc-950">
                {isPlayingRenderedShort ? (
                  <video
                    key={selectedRenderUrl}
                    src={selectedRenderUrl}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                  />
                ) : cut && videoSrc ? (
                  <video
                    src={`${videoSrc}#t=${cut.start},${cut.end}`}
                    className="h-full w-full object-cover opacity-85"
                    muted
                    loop
                    playsInline
                    autoPlay
                    crossOrigin="anonymous"
                    preload="metadata"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-3 text-center">
                    <div className="w-9 h-9 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex items-center justify-center text-zinc-400">
                      <svg
                        className="h-4 w-4 stroke-[1.5]"
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
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-300">
                      Pré-visualização 9:16
                    </span>
                    <p className="text-[11px] text-zinc-400 leading-normal max-w-[140px]">
                      Selecione um corte ou short pronto para visualizar
                    </p>
                  </div>
                )}
              </div>

              {/* Legenda de Vidro Fosco apenas no preview do corte bruto */}
              {!isPlayingRenderedShort ? (
                <div className="relative z-20 m-2 rounded-xl border border-white/10 bg-black/70 p-2 backdrop-blur-md shadow-lg">
                  <p className="line-clamp-2 text-center font-sans text-[11px] font-medium leading-relaxed text-white drop-shadow">
                    {cut?.subtitle ||
                      cut?.title ||
                      "Legendas dinâmicas posicionadas para shorts"}
                  </p>
                </div>
              ) : (
                <div className="relative z-20 m-2 flex justify-center">
                  <span className="rounded-full border border-emerald-400/35 bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 backdrop-blur-md">
                    Short Real
                  </span>
                </div>
              )}
            </div>

            {/* Botao "Ver vídeo real" ao lado do Smartphone */}
            <div className="flex flex-1 min-w-0 flex-col items-stretch justify-center gap-2">
              <GlassButton
                variant={activeRenderUrl ? "primary" : "glass"}
                size="sm"
                fullWidth
                disabled={!activeRenderUrl}
                onClick={() => {
                  if (activeRenderUrl) {
                    setIsPreviewModalOpen(true);
                  }
                }}
                className="h-auto py-2.5 px-2.5 flex-col gap-1.5 text-center whitespace-normal leading-tight"
              >
                <svg
                  className="h-4 w-4 shrink-0"
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
                <span className="text-xs font-semibold leading-tight">
                  Ver vídeo real
                </span>
              </GlassButton>

              <p className="text-center text-[10px] leading-snug text-zinc-400">
                {activeRenderUrl
                  ? "Abrir player limpo com som e velocidade"
                  : "Disponível após renderizar"}
              </p>

              {isPlayingRenderedShort && (
                <button
                  type="button"
                  onClick={() => setSelectedRenderPath(null)}
                  className="rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1 text-[10px] font-medium text-zinc-200 hover:bg-white/[0.12] hover:text-white transition-colors text-center"
                >
                  Preview do corte
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Pilares do Arco Narrativo (Hook, Desenvolvimento, Clímax, Resolução) */}
        {cut && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <svg
                  className="h-3.5 w-3.5 text-amber-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                </svg>
                Arco Narrativo
              </span>
              <span className="text-xs font-sans font-medium text-zinc-400">
                4 Pilares IA
              </span>
            </div>

            {arc ? (
              <div className="space-y-2">
                {/* Pilar 1: Gancho (Hook) */}
                <GlassCard
                  hoverable
                  className="p-3 bg-white/[0.03] border-white/[0.08] hover:border-amber-400/30 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <GlassBadge
                      variant="warning"
                      size="sm"
                      icon={
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      }
                    >
                      1. Gancho (Hook)
                    </GlassBadge>
                  </div>
                  <p className="text-xs font-sans text-zinc-200 leading-relaxed font-normal">
                    {arc.hook || "Frase de impacto inicial do corte"}
                  </p>
                </GlassCard>

                {/* Pilar 2: Desenvolvimento */}
                <GlassCard
                  hoverable
                  className="p-3 bg-white/[0.03] border-white/[0.08] hover:border-cyan-400/30 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <GlassBadge
                      variant="neutral"
                      size="sm"
                      icon={
                        <svg
                          className="h-3 w-3 text-cyan-400"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                          <polyline points="16 7 22 7 22 13" />
                        </svg>
                      }
                    >
                      2. Desenvolvimento
                    </GlassBadge>
                  </div>
                  <p className="text-xs font-sans text-zinc-200 leading-relaxed font-normal">
                    {arc.development || "Construção do contexto e raciocínio"}
                  </p>
                </GlassCard>

                {/* Pilar 3: Clímax */}
                <GlassCard
                  hoverable
                  className="p-3 bg-white/[0.03] border-white/[0.08] hover:border-rose-400/30 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <GlassBadge
                      variant="score"
                      size="sm"
                      icon={
                        <svg
                          className="h-3 w-3 text-rose-400"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                        </svg>
                      }
                    >
                      3. Clímax
                    </GlassBadge>
                  </div>
                  <p className="text-xs font-sans text-zinc-200 leading-relaxed font-normal">
                    {arc.climax || "Ponto alto ou insight principal da narrativa"}
                  </p>
                </GlassCard>

                {/* Pilar 4: Resolução */}
                <GlassCard
                  hoverable
                  className="p-3 bg-white/[0.03] border-white/[0.08] hover:border-emerald-400/30 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <GlassBadge
                      variant="success"
                      size="sm"
                      icon={
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      }
                    >
                      4. Resolução
                    </GlassBadge>
                  </div>
                  <p className="text-xs font-sans text-zinc-200 leading-relaxed font-normal">
                    {arc.resolution || "Conclusão que encerra a ideia com clareza"}
                  </p>
                </GlassCard>
              </div>
            ) : cut.reasoning || cut.summary ? (
              <GlassCard className="p-3 bg-white/[0.03] border-white/[0.08] space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <GlassBadge variant="score" size="sm">
                    Raciocínio IA
                  </GlassBadge>
                </div>
                <p className="text-xs font-sans text-zinc-200 leading-relaxed font-normal">
                  {cut.reasoning || cut.summary}
                </p>
              </GlassCard>
            ) : (
              <GlassCard className="p-3 bg-white/[0.02] border-white/[0.06] text-center">
                <p className="text-xs text-zinc-400">
                  Arco narrativo detalhado disponível após mineração da IA.
                </p>
              </GlassCard>
            )}
          </div>
        )}

        {/* Painel de Metadados e Ajuste Fino */}
        <div className="space-y-3 pt-2">
          {/* Pontos de Corte (Inicio e Fim) */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Inicio */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Início
              </span>
              <span className="font-sans font-bold tabular-nums text-base text-white tracking-tight">
                {formatTimestamp(cut?.start || 0)}
              </span>

              {/* Botoes de ajuste fino */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={!cut || readOnly || isRendering}
                  onClick={() => handleAdjustStartDelta(-1)}
                  className="flex-1 rounded-lg bg-white/[0.06] py-1.5 text-center font-sans text-xs font-semibold text-zinc-200 hover:bg-white/[0.12] hover:text-white border border-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Antecipar 1 segundo"
                >
                  -1s
                </button>
                <button
                  type="button"
                  disabled={!cut || readOnly || isRendering}
                  onClick={() => handleAdjustStartDelta(1)}
                  className="flex-1 rounded-lg bg-white/[0.06] py-1.5 text-center font-sans text-xs font-semibold text-zinc-200 hover:bg-white/[0.12] hover:text-white border border-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Adiantar 1 segundo"
                >
                  +1s
                </button>
              </div>
            </div>

            {/* Fim */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Fim
              </span>
              <span className="font-sans font-bold tabular-nums text-base text-white tracking-tight">
                {formatTimestamp(cut?.end || 0)}
              </span>

              {/* Botoes de ajuste fino */}
              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={!cut || readOnly || isRendering}
                  onClick={() => handleAdjustEndDelta(-1)}
                  className="flex-1 rounded-lg bg-white/[0.06] py-1.5 text-center font-sans text-xs font-semibold text-zinc-200 hover:bg-white/[0.12] hover:text-white border border-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Reduzir 1 segundo"
                >
                  -1s
                </button>
                <button
                  type="button"
                  disabled={!cut || readOnly || isRendering}
                  onClick={() => handleAdjustEndDelta(1)}
                  className="flex-1 rounded-lg bg-white/[0.06] py-1.5 text-center font-sans text-xs font-semibold text-zinc-200 hover:bg-white/[0.12] hover:text-white border border-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Estender 1 segundo"
                >
                  +1s
                </button>
              </div>
            </div>
          </div>

          {/* Score Viral IA (se presente) */}
          {cut?.score !== undefined && (
            <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span className="text-xs font-medium text-zinc-300">
                Potencial de Retenção
              </span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-20 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-400"
                    style={{
                      width: `${Math.min(100, Math.max(0, cut.score * 10))}%`,
                    }}
                  />
                </div>
                <span className="font-sans font-bold tabular-nums text-sm text-white">
                  {cut.score.toFixed(1)}/10
                </span>
              </div>
            </div>
          )}

          {/* Curadoria: Aprovar e Rejeitar (corte selecionado) */}
          {cut && !readOnly && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <GlassButton
                variant={selectedCutApproved ? "primary" : "glass"}
                size="sm"
                fullWidth
                disabled={isRendering}
                onClick={() => onApproveCut?.(cut.cut_id)}
                className={cn(
                  selectedCutApproved &&
                    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30",
                )}
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
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              >
                {selectedCutApproved ? "Aprovado" : "Aprovar"}
              </GlassButton>

              <GlassButton
                variant={selectedCutRejected ? "danger" : "glass"}
                size="sm"
                fullWidth
                disabled={isRendering}
                onClick={() => {
                  if (onRejectCut) {
                    onRejectCut(cut.cut_id);
                  } else if (onDiscardCut) {
                    onDiscardCut(cut.cut_id);
                  }
                }}
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                }
              >
                {selectedCutRejected ? "Rejeitado" : "Rejeitar"}
              </GlassButton>
            </div>
          )}

          {/* Botoes de Acao Principais (fallback quando cuts[] nao foi passado) */}
          {!readOnly && (
            <div className="space-y-2 pt-2">
              {!hasCutsList && (
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
              )}

              {cut && onDiscardCut && (
                <GlassButton
                  variant="danger"
                  size="sm"
                  fullWidth
                  disabled={isRendering}
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
          )}
        </div>
      </div>

      {/* Modal Limpo de Pre-visualizacao do Short Renderizado */}
      <ShortPreviewModal
        isOpen={isPreviewModalOpen && Boolean(activeRenderUrl)}
        src={activeRenderUrl}
        title={activeRenderTitle}
        onClose={() => setIsPreviewModalOpen(false)}
      />
    </aside>
  );
}
