import { useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  CaretDown,
  Check,
  DotsThree,
  DownloadSimple,
  FileText,
  FolderOpen,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { Cut, JobStatus } from "../../types";
import {
  CUT_PRESETS,
  formatShortTime,
  getHumanErrorMessage,
  getHumanJobStatusLabel,
  isJobProcessingStatus,
  type CutPreset,
} from "./presets";

export interface DockCutItem extends Cut {
  renderedFileName?: string | null;
}

interface GlassDockProps {
  sidebarPinned: boolean;
  collapsed: boolean;
  isImmersive: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  videoSrc: string | null;
  jobStatus?: JobStatus | null;
  jobError?: string | null;
  cuts: DockCutItem[];
  selectedCutId: string | null;
  showDiscarded: boolean;
  selectedPreset: CutPreset["id"];
  reviewBeforeRender: boolean;
  waitingApproval: boolean;
  transcriptOpen: boolean;
  onToggleCollapsed: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onPrevCut: () => void;
  onNextCut: () => void;
  onCycleSpeed: () => void;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleTranscript: () => void;
  onSelectCut: (cutId: string) => void;
  onWatchCut: (cut: DockCutItem) => void;
  onApproveCut: (cutId: string) => void;
  onDiscardCut: (cutId: string) => void;
  onAdjustCutTime: (cutId: string, field: "start" | "end", delta: number) => void;
  onRenameCut: (cutId: string, title: string) => void;
  onDownloadRenderedCut: (fileName: string) => void;
  onOpenRenderedFolder: (fileName: string) => void;
  onDeleteRenderedCut: (fileName: string) => void;
  onChangePreset: (preset: CutPreset["id"]) => void;
  onToggleReviewBefore: () => void;
  onGenerateCuts: () => void;
  onContinueApproval: () => void;
  onCancelProcessing: () => void;
  onRetryError: () => void;
}

export function GlassDock({
  sidebarPinned,
  collapsed,
  isImmersive,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  volume,
  muted,
  videoSrc,
  jobStatus,
  jobError,
  cuts,
  selectedCutId,
  showDiscarded,
  selectedPreset,
  reviewBeforeRender,
  waitingApproval,
  transcriptOpen,
  onToggleCollapsed,
  onTogglePlay,
  onSeek,
  onPrevCut,
  onNextCut,
  onCycleSpeed,
  onToggleMute,
  onVolumeChange,
  onToggleTranscript,
  onSelectCut,
  onWatchCut,
  onApproveCut,
  onDiscardCut,
  onAdjustCutTime,
  onRenameCut,
  onDownloadRenderedCut,
  onOpenRenderedFolder,
  onDeleteRenderedCut,
  onChangePreset,
  onToggleReviewBefore,
  onGenerateCuts,
  onContinueApproval,
  onCancelProcessing,
  onRetryError,
}: GlassDockProps) {
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [cutMenuId, setCutMenuId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");

  const maxCutEnd = cuts.reduce((max, c) => Math.max(max, c.end), 0);
  const safeDuration =
    duration > 0 ? duration : maxCutEnd > 0 ? Math.ceil(maxCutEnd * 1.1) : 1;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));

  const visibleCuts = useMemo(
    () =>
      cuts
        .filter((c) => showDiscarded || c.status !== "rejected")
        .slice()
        .sort((a, b) => a.start - b.start),
    [cuts, showDiscarded],
  );

  // Calcula posições sem sobreposição na trilha horizontal
  const positionedCuts = useMemo(() => {
    const cardWidth = 164;
    const trackMinPx = Math.max(720, visibleCuts.length * (cardWidth + 16));
    let lastRightPx = -Infinity;
    return visibleCuts.map((cut) => {
      const rawLeftPx = (cut.start / safeDuration) * trackMinPx;
      const clampedLeft = Math.max(rawLeftPx, lastRightPx + 10);
      lastRightPx = clampedLeft + cardWidth;
      const segLeftPct = Math.min(100, Math.max(0, (cut.start / safeDuration) * 100));
      const segWidthPct = Math.min(
        100 - segLeftPct,
        Math.max(1.2, ((cut.end - cut.start) / safeDuration) * 100),
      );
      return {
        cut,
        leftPx: clampedLeft,
        segLeftPct,
        segWidthPct,
      };
    });
  }, [visibleCuts, safeDuration]);

  const timelineTrackWidth = useMemo(() => {
    if (positionedCuts.length === 0) return "100%";
    const maxRight = positionedCuts[positionedCuts.length - 1].leftPx + 180;
    return `max(100%, ${Math.ceil(maxRight)}px)`;
  }, [positionedCuts]);

  // Marcas regulares na régua (sem "0" solto)
  const rulerTicks = useMemo(() => {
    const effective = duration > 0 ? duration : maxCutEnd > 0 ? safeDuration : 0;
    if (effective <= 0) return [];
    const step = effective >= 2400 ? 600 : effective >= 600 ? 300 : effective >= 180 ? 60 : 30;
    const ticks: { sec: number; label: string; pct: number }[] = [];
    for (let t = step; t < effective - step * 0.25; t += step) {
      ticks.push({
        sec: t,
        label: formatShortTime(t),
        pct: (t / effective) * 100,
      });
    }
    ticks.push({ sec: effective, label: formatShortTime(effective), pct: 100 });
    return ticks;
  }, [duration, maxCutEnd, safeDuration]);

  const handleScrub = (clientX: number) => {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const activePreset = CUT_PRESETS.find((p) => p.id === selectedPreset) || CUT_PRESETS[0];
  const isProcessing = isJobProcessingStatus(jobStatus);
  const statusLabel = getHumanJobStatusLabel(jobStatus);
  const selectedCut = visibleCuts.find((c) => c.cut_id === selectedCutId) || null;

  const speedLabel = `${playbackRate}x`;

  return (
    <section
      aria-label="Controles e timeline"
      data-collapsed={collapsed ? "true" : "false"}
      className="fixed z-dock bottom-4 right-4 rounded-panel glass transition-[height,left] duration-slow ease-out overflow-visible"
      style={{
        left: sidebarPinned
          ? "calc(var(--sidebar-w) + var(--sidebar-gap) + var(--dock-gap))"
          : "var(--dock-gap)",
        height: collapsed ? "var(--dock-h-collapsed)" : "var(--dock-h)",
      }}
    >
      {/* Setinha discreta de recolher/expandir */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expandir dock" : "Recolher dock"}
        className={[
          "absolute left-1/2 -translate-x-1/2 z-10 grid h-4 w-7 place-items-center text-text-3 hover:text-text-1 transition-[color,transform,top,bottom] duration-base ease-out",
          collapsed ? "top-1" : "bottom-1",
        ].join(" ")}
      >
        <CaretDown
          size={14}
          weight="regular"
          className={[
            "transition-transform duration-base ease-out",
            collapsed ? "rotate-180" : "rotate-0",
          ].join(" ")}
        />
      </button>

      <div className="h-full px-4 py-3 flex flex-col justify-between gap-2.5">
        {/* Linha de reprodução (sempre visível) */}
        <div className="flex items-center gap-3 h-8 shrink-0">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? "Pausar" : "Reproduzir"}
            className="grid h-8 w-8 place-items-center rounded-pill text-text-1 hover:bg-glass-hover transition-colors duration-fast shrink-0"
          >
            {isPlaying ? <Pause size={20} weight="regular" /> : <Play size={20} weight="regular" />}
          </button>

          {!collapsed && (
            <button
              type="button"
              onClick={onPrevCut}
              disabled={visibleCuts.length === 0}
              aria-label="Corte anterior"
              className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 transition-colors duration-fast shrink-0"
            >
              <SkipBack size={16} weight="regular" />
            </button>
          )}

          <span className="text-sm text-text-2 tabular-nums shrink-0">
            <span className="text-text-1">{formatShortTime(currentTime)}</span>
            <span className="mx-1 text-text-3">/</span>
            <span>{formatShortTime(duration)}</span>
          </span>

          {/* Scrubber com marcadores azuis dos cortes */}
          <div
            ref={scrubberRef}
            role="slider"
            tabIndex={0}
            aria-label="Progresso do vídeo"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            onClick={(e) => handleScrub(e.clientX)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 5));
              if (e.key === "ArrowRight") onSeek(Math.min(duration, currentTime + 5));
            }}
            className="group relative flex-1 h-5 flex items-center cursor-pointer"
          >
            <div className="relative w-full h-[4px] group-hover:h-[6px] rounded-pill bg-white/[0.18] transition-[height] duration-fast">
              {!isImmersive &&
                positionedCuts.map(({ cut, segLeftPct, segWidthPct }) => (
                  <button
                    key={cut.cut_id}
                    type="button"
                    aria-label={`Ir para corte ${cut.title || ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCut(cut.cut_id);
                      onSeek(cut.start);
                    }}
                    className="absolute inset-y-0 rounded-pill bg-accent-seg hover:bg-accent transition-colors duration-fast"
                    style={{ left: `${segLeftPct}%`, width: `${segWidthPct}%` }}
                  />
                ))}

              <div
                className="absolute inset-y-0 left-0 rounded-pill bg-white/90 pointer-events-none"
                style={{ width: `${progressPct}%` }}
              />

              <div
                className="absolute top-1/2 h-3 w-3 rounded-pill bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] -translate-x-1/2 -translate-y-1/2 scale-0 group-hover:scale-100 group-focus-visible:scale-100 transition-transform duration-fast ease-out pointer-events-none"
                style={{ left: `${progressPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onCycleSpeed}
            aria-label="Velocidade de reprodução"
            className="h-7 px-2.5 rounded-pill bg-white/[0.06] border border-line text-sm text-text-1 tabular-nums hover:bg-glass-hover transition-colors duration-fast shrink-0"
          >
            {speedLabel}
          </button>

          {!collapsed && (
            <>
              <button
                type="button"
                onClick={onNextCut}
                disabled={visibleCuts.length === 0}
                aria-label="Próximo corte"
                className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 transition-colors duration-fast shrink-0"
              >
                <SkipForward size={16} weight="regular" />
              </button>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={muted ? "Ativar som" : "Silenciar"}
                  className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 transition-colors duration-fast"
                >
                  {muted || volume === 0 ? (
                    <SpeakerSlash size={16} weight="regular" />
                  ) : (
                    <SpeakerHigh size={16} weight="regular" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-14 h-1 accent-white cursor-pointer"
                />
              </div>
            </>
          )}
        </div>

        {/* Timeline com cartões de corte (oculto quando recolhido) */}
        <div
          className={[
            "flex items-start gap-3 flex-1 min-h-0 transition-opacity duration-base",
            collapsed ? "opacity-0 pointer-events-none hidden" : "opacity-100",
          ].join(" ")}
        >
          {/* Botão Transcrição à esquerda da régua */}
          <button
            type="button"
            onClick={onToggleTranscript}
            aria-expanded={transcriptOpen}
            className={[
              "h-8 px-3 rounded-pill inline-flex items-center gap-1.5 text-sm border transition-colors duration-fast shrink-0 mt-0.5",
              transcriptOpen
                ? "bg-glass-active border-line-strong text-text-1"
                : "bg-white/[0.06] border-line text-text-2 hover:text-text-1 hover:bg-glass-hover",
            ].join(" ")}
          >
            <FileText size={15} weight="regular" />
            <span>Transcrição</span>
          </button>

          {/* Área rolável da régua + cartões */}
          <div className="flex-1 overflow-x-auto no-scrollbar snap-x snap-proximity h-full">
            <div className="relative h-full" style={{ width: timelineTrackWidth }}>
              {/* Régua de tempo */}
              <div className="relative h-4 text-xs text-text-3 tabular-nums select-none">
                {rulerTicks.map((tick) => (
                  <span
                    key={tick.sec}
                    className="absolute top-0 -translate-x-1/2"
                    style={{ left: tick.pct === 100 ? "calc(100% - 18px)" : `${tick.pct}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>

              {/* Faixa de segmentos azuis */}
              <div className="relative h-2 w-full rounded-pill bg-white/[0.06] mt-0.5">
                {positionedCuts.map(({ cut, segLeftPct, segWidthPct }) => (
                  <div
                    key={cut.cut_id}
                    className="absolute inset-y-0 rounded-pill bg-accent-seg"
                    style={{ left: `${segLeftPct}%`, width: `${segWidthPct}%` }}
                  />
                ))}
              </div>

              {/* Cartões posicionados pelo tempo real */}
              <div className="relative h-[86px] mt-1">
                {positionedCuts.length === 0 ? (
                  <div className="h-full flex items-center text-xs text-text-3">
                    {isProcessing
                      ? statusLabel || "Processando…"
                      : "Nenhum corte gerado ainda. Escolha um preset e clique em Gerar cortes."}
                  </div>
                ) : (
                  positionedCuts.map(({ cut, leftPx }) => {
                    const isSelected = cut.cut_id === selectedCutId;
                    const isReady = Boolean(cut.renderedFileName);
                    const isRejected = cut.status === "rejected";
                    const isApproved = cut.status === "approved";
                    const statusText = isReady
                      ? "Pronto"
                      : isApproved
                        ? "Aprovado"
                        : isRejected
                          ? "Descartado"
                          : "Sugerido";
                    const cutDuration = Math.max(0, cut.end - cut.start);
                    const thumbUrl = videoSrc ? `${videoSrc}#t=${Math.floor(cut.start)}` : undefined;

                    return (
                      <div
                        key={cut.cut_id}
                        role="button"
                        tabIndex={0}
                        aria-selected={isSelected}
                        data-status={isRejected ? "descartado" : statusText.toLowerCase()}
                        onClick={() => {
                          onSelectCut(cut.cut_id);
                          onSeek(cut.start);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectCut(cut.cut_id);
                            onSeek(cut.start);
                          }
                        }}
                        style={{ left: `${leftPx}px`, width: "var(--card-w)" }}
                        className={[
                          "absolute top-2 snap-start p-1.5 rounded-card border cursor-pointer flex items-center gap-2 transition-[transform,box-shadow,background-color,opacity] duration-base ease-out",
                          isSelected
                            ? "-translate-y-0.5 bg-[rgba(91,156,255,0.10)] border-transparent shadow-[0_0_0_1.5px_var(--accent-ring),var(--shadow-card)]"
                            : "bg-white/[0.05] border-line shadow-card hover:-translate-y-[1px] hover:bg-white/[0.08]",
                          isRejected ? "opacity-35 grayscale" : "",
                        ].join(" ")}
                      >
                        {/* Ponto azul + linha de 1px ligando à faixa */}
                        <span
                          aria-hidden="true"
                          className="absolute -top-2.5 left-4 w-[1px] h-2 bg-accent-soft/60"
                        />
                        <span
                          aria-hidden="true"
                          className="absolute -top-3 left-[13.5px] w-1.5 h-1.5 rounded-pill bg-accent-soft"
                        />

                        <div className="relative h-[56px] aspect-[9/16] shrink-0 rounded-[6px] overflow-hidden bg-black/50 border border-line">
                          {thumbUrl ? (
                            <video
                              src={thumbUrl}
                              preload="metadata"
                              muted
                              playsInline
                              className="w-full h-full object-cover pointer-events-none"
                            />
                          ) : null}
                          {isReady && (
                            <span
                              title="Pronto para baixar"
                              className="absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-pill bg-black/75 text-text-1"
                            >
                              <DownloadSimple size={9} weight="regular" />
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 flex flex-col justify-between h-[56px] py-0.5">
                          {editingTitleId === cut.cut_id ? (
                            <input
                              type="text"
                              value={editingTitleValue}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setEditingTitleValue(e.target.value)}
                              onBlur={() => {
                                if (editingTitleValue.trim()) {
                                  onRenameCut(cut.cut_id, editingTitleValue.trim());
                                }
                                setEditingTitleId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (editingTitleValue.trim()) {
                                    onRenameCut(cut.cut_id, editingTitleValue.trim());
                                  }
                                  setEditingTitleId(null);
                                }
                                if (e.key === "Escape") setEditingTitleId(null);
                              }}
                              className="w-full px-1 py-0.5 rounded bg-black/60 border border-line-strong text-xs text-text-1 focus-visible:ring-2 focus-visible:ring-accent-ring"
                            />
                          ) : (
                            <p
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingTitleId(cut.cut_id);
                                setEditingTitleValue(cut.title || "Corte");
                              }}
                              className="text-xs font-medium text-text-1 leading-tight line-clamp-2"
                            >
                              {cut.title || "Corte sugerido"}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-1 text-[11px] text-text-2 tabular-nums">
                            <span className="inline-flex items-center gap-1 truncate">
                              <span
                                className={[
                                  "w-1.5 h-1.5 rounded-pill inline-block shrink-0",
                                  isReady || isApproved ? "bg-accent-soft" : "bg-success",
                                ].join(" ")}
                              />
                              <span className="truncate">{statusText}</span>
                            </span>
                            <span className="shrink-0 text-text-3">{formatShortTime(cutDuration)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé de ações do dock (oculto quando recolhido) */}
        <div
          className={[
            "flex items-center justify-between gap-3 h-9 shrink-0 transition-opacity duration-base",
            collapsed ? "opacity-0 pointer-events-none hidden" : "opacity-100",
          ].join(" ")}
        >
          {/* Esquerda: ações do corte selecionado OU status do job */}
          <div className="flex items-center gap-1.5 min-w-0">
            {selectedCut ? (
              <>
                <button
                  type="button"
                  onClick={() => onWatchCut(selectedCut)}
                  className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-sm bg-white/[0.06] border border-line text-text-1 hover:bg-white/[0.12] transition-colors duration-fast"
                >
                  <Play size={13} weight="regular" />
                  <span>Assistir</span>
                </button>

                <button
                  type="button"
                  onClick={() => onApproveCut(selectedCut.cut_id)}
                  className={[
                    "h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-sm border transition-colors duration-fast",
                    selectedCut.status === "approved"
                      ? "bg-accent/20 border-accent-soft/40 text-text-1"
                      : "bg-white/[0.06] border-line text-text-1 hover:bg-white/[0.12]",
                  ].join(" ")}
                >
                  <Check size={13} weight="regular" className="text-success" />
                  <span>Aprovar</span>
                </button>

                <button
                  type="button"
                  onClick={() => onDiscardCut(selectedCut.cut_id)}
                  className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1.5 text-sm bg-white/[0.06] border border-line text-text-1 hover:bg-[var(--danger-bg)] hover:text-danger transition-colors duration-fast"
                >
                  <X size={13} weight="regular" />
                  <span>Descartar</span>
                </button>

                {/* Menu … do corte selecionado para ajuste fino (±1s), título e ações de pronto */}
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Mais opções do corte"
                    onClick={() =>
                      setCutMenuId((prev) =>
                        prev === selectedCut.cut_id ? null : selectedCut.cut_id,
                      )
                    }
                    className="grid h-7 w-7 place-items-center rounded-pill bg-white/[0.06] border border-line text-text-2 hover:text-text-1 hover:bg-white/[0.12] transition-colors duration-fast"
                  >
                    <DotsThree size={15} weight="regular" />
                  </button>

                  {cutMenuId === selectedCut.cut_id && (
                    <div
                      role="menu"
                      className="absolute bottom-[calc(100%+8px)] left-0 z-popover w-56 rounded-card glass--strong p-2.5 space-y-2.5 shadow-pop"
                    >
                      <div className="flex items-center justify-between text-xs text-text-2">
                        <span>Início ({formatShortTime(selectedCut.start)})</span>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onAdjustCutTime(selectedCut.cut_id, "start", -1)}
                            className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] hover:bg-glass-hover text-text-1"
                            aria-label="Diminuir início 1 segundo"
                          >
                            <Minus size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onAdjustCutTime(selectedCut.cut_id, "start", 1)}
                            className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] hover:bg-glass-hover text-text-1"
                            aria-label="Avançar início 1 segundo"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-text-2">
                        <span>Fim ({formatShortTime(selectedCut.end)})</span>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onAdjustCutTime(selectedCut.cut_id, "end", -1)}
                            className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] hover:bg-glass-hover text-text-1"
                            aria-label="Diminuir fim 1 segundo"
                          >
                            <Minus size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onAdjustCutTime(selectedCut.cut_id, "end", 1)}
                            className="grid h-6 w-6 place-items-center rounded bg-white/[0.06] hover:bg-glass-hover text-text-1"
                            aria-label="Avançar fim 1 segundo"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCutMenuId(null);
                          setEditingTitleId(selectedCut.cut_id);
                          setEditingTitleValue(selectedCut.title || "");
                        }}
                        className="w-full text-left px-2 py-1 rounded text-xs text-text-2 hover:bg-glass-hover hover:text-text-1"
                      >
                        Editar título
                      </button>

                      {selectedCut.renderedFileName && (
                        <div className="pt-2 border-t border-line space-y-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCutMenuId(null);
                              onDownloadRenderedCut(selectedCut.renderedFileName!);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-text-1 hover:bg-glass-hover"
                          >
                            <DownloadSimple size={13} />
                            <span>Baixar vídeo pronto</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCutMenuId(null);
                              onOpenRenderedFolder(selectedCut.renderedFileName!);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-text-2 hover:bg-glass-hover hover:text-text-1"
                          >
                            <FolderOpen size={13} />
                            <span>Abrir pasta</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCutMenuId(null);
                              onDeleteRenderedCut(selectedCut.renderedFileName!);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-danger hover:bg-[var(--danger-bg)]"
                          >
                            <Trash size={13} />
                            <span>Excluir arquivo</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : jobStatus === "ERROR" || jobError ? (
              <div className="inline-flex items-center gap-2 px-3 h-7 rounded-pill bg-[var(--danger-bg)] border border-danger/30 text-xs text-danger truncate">
                <span className="truncate">{getHumanErrorMessage(jobError)}</span>
                <button
                  type="button"
                  onClick={onRetryError}
                  className="inline-flex items-center gap-1 font-medium underline shrink-0"
                >
                  <ArrowCounterClockwise size={12} />
                  <span>Tentar de novo</span>
                </button>
              </div>
            ) : isProcessing && statusLabel ? (
              <div className="inline-flex items-center gap-2 text-sm text-text-2">
                <span>{statusLabel}</span>
                <button
                  type="button"
                  onClick={onCancelProcessing}
                  className="text-xs text-text-3 hover:text-text-1 underline"
                >
                  Cancelar
                </button>
              </div>
            ) : null}
          </div>

          {/* Direita: Preset + Revisar antes + Gerar cortes */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative">
              <button
                type="button"
                onClick={() => setPresetMenuOpen((o) => !o)}
                aria-expanded={presetMenuOpen}
                className="h-9 px-3.5 rounded-pill inline-flex items-center gap-2 bg-white/[0.06] border border-line text-base text-text-1 hover:bg-glass-hover transition-colors duration-fast"
              >
                <span>{activePreset.label}</span>
                <CaretDown size={13} weight="regular" className="text-text-2" />
              </button>

              {presetMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-[calc(100%+8px)] right-0 z-popover w-56 rounded-card glass--strong p-1.5 shadow-pop"
                >
                  {CUT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChangePreset(preset.id);
                        setPresetMenuOpen(false);
                      }}
                      className={[
                        "w-full flex flex-col items-start px-3 py-2 rounded-thumb text-left transition-colors duration-fast",
                        preset.id === selectedPreset
                          ? "bg-glass-active text-text-1"
                          : "text-text-2 hover:bg-glass-hover hover:text-text-1",
                      ].join(" ")}
                    >
                      <span className="text-sm font-medium text-text-1">{preset.label}</span>
                      <span className="text-xs text-text-3">{preset.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="h-9 px-3 rounded-pill inline-flex items-center gap-2 bg-white/[0.06] border border-line">
              <span className="text-sm text-text-1 select-none">Revisar antes</span>
              <button
                type="button"
                role="switch"
                aria-checked={reviewBeforeRender}
                aria-label="Revisar antes"
                onClick={onToggleReviewBefore}
                className={[
                  "relative w-9 h-5 rounded-pill transition-colors duration-base ease-out",
                  reviewBeforeRender ? "bg-accent" : "bg-white/[0.18]",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-pill bg-white transition-transform duration-base ease-out",
                    reviewBeforeRender ? "translate-x-4" : "translate-x-0",
                  ].join(" ")}
                />
              </button>
            </div>

            {waitingApproval ? (
              <button
                type="button"
                onClick={onContinueApproval}
                className="h-9 px-4 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active active:scale-[0.98] transition-[background-color,transform] duration-fast"
              >
                Renderizar aprovados
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing}
                onClick={onGenerateCuts}
                className="h-9 px-4 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed transition-[background-color,transform] duration-fast"
              >
                {isProcessing ? "Processando…" : "Gerar cortes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
