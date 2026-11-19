import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowCounterClockwise,
  CaretDown,
  Check,
  DotsThreeVertical,
  DownloadSimple,
  FolderOpen,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  SpinnerGap,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { Cut, JobStatus } from "../../types";
import {
  formatLastError,
  formatShortTime,
  getHumanErrorMessage,
  getHumanJobStatusLabel,
  isJobProcessingStatus,
} from "./presets";
import { TerminalPanel } from "./TerminalPanel";

export interface DockCutItem extends Cut {
  renderedFileName?: string | null;
}

const DEFAULT_SPEED_STEPS: ReadonlyArray<number> = [1, 1.25, 1.5, 2, 2.5, 3, 4];

interface GlassDockProps {
  sidebarPinned: boolean;
  transcriptPinned?: boolean;
  pinnedTranscriptSide?: "left" | "right" | null;
  pinnedTranscriptWithSidebar?: boolean;
  transcriptAboveDock?: boolean;
  sidebarSide?: "left" | "right";
  collapsed: boolean;
  isImmersive: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  videoSrc: string | null;
  activeJobId?: string | null;
  jobStatus?: JobStatus | null;
  jobError?: string | null;
  /** `job.last_error` (etapa + mensagem curta da última falha), quando o backend informa. */
  jobLastError?: { stage?: string | null; message?: string | null } | null;
  isActivelyProcessing?: boolean;
  cuts: DockCutItem[];
  selectedCutId: string | null;
  showDiscarded: boolean;
  reviewBeforeRender: boolean;
  waitingApproval: boolean;
  transcriptOpen?: boolean;
  cutResumePositions?: Record<string, number>;
  onResumeCut?: (cutId: string) => void;
  isRenderingCuts?: boolean;
  onToggleCollapsed: () => void;
  minimizedVisible?: boolean;
  onMinimizedVisibilityChange?: (visible: boolean) => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onPrevCut: () => void;
  onNextCut: () => void;
  onCycleSpeed: () => void;
  onSelectSpeed?: (nextSpeed: number) => void;
  speedSteps?: ReadonlyArray<number>;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleTranscript?: () => void;
  onSelectCut: (cutId: string, options?: { seekTo?: number }) => void;
  onWatchCut: (cut: DockCutItem) => void;
  onApproveCut: (cutId: string) => void;
  onDiscardCut: (cutId: string) => void;
  onAdjustCutTime: (cutId: string, field: "start" | "end", delta: number) => void;
  onRenameCut: (cutId: string, title: string) => void;
  onDeleteCut?: (cutId: string) => void;
  onDownloadRenderedCut: (fileName: string) => void;
  onOpenRenderedFolder: (fileName: string) => void;
  onOpenVideoFolder?: () => void;
  onDeleteRenderedCut: (fileName: string) => void;
  onToggleReviewBefore: () => void;
  onGenerateCuts: () => void;
  onContinueApproval: () => void;
  onCancelProcessing: () => void;
  onRetryError: () => void;
  /** Abre a pasta de logs do vídeo atual no computador. */
  onOpenLogs?: () => void;
}

export function GlassDock({
  sidebarPinned,
  transcriptPinned = false,
  pinnedTranscriptSide = null,
  pinnedTranscriptWithSidebar = false,
  transcriptAboveDock = false,
  sidebarSide = "left",
  collapsed,
  isImmersive,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  volume,
  muted,
  videoSrc,
  activeJobId = null,
  jobStatus,
  jobError,
  jobLastError,
  isActivelyProcessing,
  cuts,
  selectedCutId,
  showDiscarded,
  reviewBeforeRender,
  waitingApproval,
  cutResumePositions,
  onResumeCut,
  isRenderingCuts,
  onToggleCollapsed,
  minimizedVisible,
  onMinimizedVisibilityChange,
  onTogglePlay,
  onSeek,
  onPrevCut,
  onNextCut,
  onCycleSpeed,
  onSelectSpeed,
  speedSteps = DEFAULT_SPEED_STEPS,
  onToggleMute,
  onVolumeChange,
  onSelectCut,
  onWatchCut,
  onApproveCut,
  onDiscardCut,
  onAdjustCutTime,
  onRenameCut,
  onDeleteCut,
  onDownloadRenderedCut: _onDownloadRenderedCut,
  onOpenRenderedFolder,
  onOpenVideoFolder,
  onDeleteRenderedCut: _onDeleteRenderedCut,
  onToggleReviewBefore,
  onGenerateCuts,
  onContinueApproval,
  onCancelProcessing,
  onRetryError,
  onOpenLogs,
}: GlassDockProps) {
  const scrubberRef = useRef<HTMLDivElement>(null);
  const playbackRowRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [scrubberMetrics, setScrubberMetrics] = useState<{
    offsetLeft: number;
    width: number;
    rowWidth: number;
  } | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [cutMenuState, setCutMenuState] = useState<{
    cutId: string;
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const [cutMenuEntered, setCutMenuEntered] = useState(false);
  const cutMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cutMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const [speedMenuState, setSpeedMenuState] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    openUpward: boolean;
  } | null>(null);
  const [speedMenuEntered, setSpeedMenuEntered] = useState(false);
  const speedMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const speedMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const [hoveredCutId, setHoveredCutId] = useState<string | null>(null);
  const [focusedCutId, setFocusedCutId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [minimizedHidden, setMinimizedHidden] = useState(false);
  const isDockHoveredRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVisibilityChangeRef = useRef(onMinimizedVisibilityChange);
  onVisibilityChangeRef.current = onMinimizedVisibilityChange;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const minimizedHiddenRef = useRef(minimizedHidden);
  minimizedHiddenRef.current = minimizedHidden;
  const transcriptAboveDockRef = useRef(transcriptAboveDock);
  transcriptAboveDockRef.current = transcriptAboveDock;
  const effectiveMinimizedHidden = minimizedHidden && !(collapsed && transcriptAboveDock);

  const isPointerInsideDockZone = (x: number, y: number): boolean => {
    const sectionEl = sectionRef.current;
    if (!sectionEl) return false;
    const rect = sectionEl.getBoundingClientRect();
    if (rect.width === 0) return false;
    const rootStyles = getComputedStyle(document.documentElement);
    const collapsedH = parseFloat(rootStyles.getPropertyValue("--dock-h-collapsed")) || 56;
    const dockGap = parseFloat(rootStyles.getPropertyValue("--dock-gap")) || 16;
    const bottomY = window.innerHeight;
    const topY = bottomY - (collapsedH + dockGap);
    return x >= rect.left && x <= rect.right && y >= topY && y <= bottomY;
  };

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    clearHideTimer();
    if (transcriptAboveDockRef.current) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      if (transcriptAboveDockRef.current) return;
      const pt = lastPointerRef.current;
      if (pt && isPointerInsideDockZone(pt.x, pt.y)) {
        isDockHoveredRef.current = true;
        return;
      }
      isDockHoveredRef.current = false;
      setMinimizedHidden(true);
      onVisibilityChangeRef.current?.(false);
    }, 3000);
  };

  useEffect(() => {
    const handleWindowMouseMove = (e: globalThis.MouseEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      if (!collapsedRef.current || transcriptAboveDockRef.current) return;

      const inside = isPointerInsideDockZone(e.clientX, e.clientY);
      if (isDockHoveredRef.current && !inside) {
        isDockHoveredRef.current = false;
        if (!minimizedHiddenRef.current && hideTimerRef.current === null) {
          scheduleHide();
        }
      } else if (inside && !minimizedHiddenRef.current) {
        clearHideTimer();
        isDockHoveredRef.current = true;
      }
    };

    const handleDocumentMouseLeave = () => {
      lastPointerRef.current = null;
      if (collapsedRef.current && !transcriptAboveDockRef.current && isDockHoveredRef.current) {
        isDockHoveredRef.current = false;
        if (!minimizedHiddenRef.current && hideTimerRef.current === null) {
          scheduleHide();
        }
      }
    };

    window.addEventListener("mousemove", handleWindowMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleDocumentMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      document.removeEventListener("mouseleave", handleDocumentMouseLeave);
    };
  }, []);

  useEffect(() => {
    clearHideTimer();
    setMinimizedHidden(false);
    onVisibilityChangeRef.current?.(true);

    if (collapsed && !transcriptAboveDock) {
      const pt = lastPointerRef.current;
      const inside = pt ? isPointerInsideDockZone(pt.x, pt.y) : false;
      isDockHoveredRef.current = inside;
      if (!inside) {
        scheduleHide();
      }
    } else {
      isDockHoveredRef.current = false;
    }

    return () => {
      clearHideTimer();
    };
  }, [collapsed, transcriptAboveDock]);

  useEffect(() => {
    if (!collapsed || minimizedVisible === undefined) return;
    if (transcriptAboveDock) {
      clearHideTimer();
      if (minimizedHidden) {
        setMinimizedHidden(false);
        onVisibilityChangeRef.current?.(true);
      }
      return;
    }
    if (minimizedVisible && minimizedHidden) {
      clearHideTimer();
      setMinimizedHidden(false);
      const pt = lastPointerRef.current;
      const inside = pt ? isPointerInsideDockZone(pt.x, pt.y) : false;
      isDockHoveredRef.current = inside;
      if (!inside) {
        scheduleHide();
      }
    } else if (!minimizedVisible && !minimizedHidden) {
      clearHideTimer();
      isDockHoveredRef.current = false;
      setMinimizedHidden(true);
    }
  }, [collapsed, minimizedVisible, transcriptAboveDock]);

  useEffect(() => {
    setHoveredCutId(null);
    setFocusedCutId(null);
    setCutMenuState(null);
  }, [selectedCutId]);

  useEffect(() => {
    setSpeedMenuState(null);
    if (collapsed) {
      setHoveredCutId(null);
      setFocusedCutId(null);
      setCutMenuState(null);
      setTerminalOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    if (effectiveMinimizedHidden) {
      setSpeedMenuState(null);
    }
  }, [effectiveMinimizedHidden]);

  useEffect(() => {
    if (!cutMenuState) {
      setCutMenuEntered(false);
      return;
    }
    setCutMenuEntered(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setCutMenuEntered(true));
    });
    const handleOutsidePointer = (e: globalThis.MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (
        cutMenuPopoverRef.current?.contains(target) ||
        cutMenuTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setCutMenuState(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCutMenuState(null);
      }
    };
    const handleClose = () => {
      setCutMenuState(null);
    };
    window.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("mousedown", handleOutsidePointer);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("mousedown", handleOutsidePointer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, [cutMenuState]);

  useEffect(() => {
    if (!speedMenuState) {
      setSpeedMenuEntered(false);
      return;
    }
    setSpeedMenuEntered(false);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setSpeedMenuEntered(true));
    });
    const handleOutsidePointer = (e: globalThis.MouseEvent | PointerEvent) => {
      const target = e.target as Node | null;
      if (
        speedMenuPopoverRef.current?.contains(target) ||
        speedMenuTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setSpeedMenuState(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSpeedMenuState(null);
      }
    };
    const handleClose = () => {
      setSpeedMenuState(null);
    };
    window.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("mousedown", handleOutsidePointer);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleClose);
    window.addEventListener("scroll", handleClose, true);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("mousedown", handleOutsidePointer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("scroll", handleClose, true);
    };
  }, [speedMenuState]);

  useEffect(() => {
    if (hoveredCutId === null) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const overId =
        (e.target as Element | null)?.closest("[data-cut-card]")?.getAttribute("data-cut-card") ??
        null;
      if (overId !== hoveredCutId) {
        setHoveredCutId(overId);
      }
    };

    const handleClearHover = () => {
      setHoveredCutId(null);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleClearHover);
    window.addEventListener("blur", handleClearHover);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleClearHover);
      window.removeEventListener("blur", handleClearHover);
    };
  }, [hoveredCutId]);

  useEffect(() => {
    const scrubberEl = scrubberRef.current;
    const rowEl = playbackRowRef.current;
    if (!scrubberEl || !rowEl) return;

    const measure = () => {
      const scrubRect = scrubberEl.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      if (scrubRect.width <= 0) return;
      const nextOffset = Math.max(0, scrubRect.left - rowRect.left);
      const nextWidth = scrubRect.width;
      const nextRowWidth = rowRect.width;
      setScrubberMetrics((prev) =>
        prev &&
        Math.abs(prev.offsetLeft - nextOffset) < 0.5 &&
        Math.abs(prev.width - nextWidth) < 0.5 &&
        Math.abs(prev.rowWidth - nextRowWidth) < 0.5
          ? prev
          : { offsetLeft: nextOffset, width: nextWidth, rowWidth: nextRowWidth },
      );
    };

    measure();
    const timer = window.setTimeout(measure, 320);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(scrubberEl);
    observer.observe(rowEl);
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [
    collapsed,
    sidebarPinned,
    transcriptPinned,
    pinnedTranscriptSide,
    pinnedTranscriptWithSidebar,
    sidebarSide,
    duration,
  ]);

  const handleDockMouseEnter = (e: ReactMouseEvent<HTMLElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    clearHideTimer();
    isDockHoveredRef.current = true;
    setMinimizedHidden(false);
    onVisibilityChangeRef.current?.(true);
  };

  const handleDockMouseLeave = (e: ReactMouseEvent<HTMLElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (collapsed && isPointerInsideDockZone(e.clientX, e.clientY)) {
      return;
    }
    isDockHoveredRef.current = false;
    if (collapsed && !transcriptAboveDock) {
      scheduleHide();
    }
  };

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

  // Calcula posições alinhadas ao ponto médio na barra de progressão, mantendo borda esquerda estável ao expandir Retomar
  const { positionedCuts, timelineTrackWidth } = useMemo(() => {
    const MIN_COMPACT_CARD_W = 42;
    const MINIMIZED_CARD_W = 64;
    const HOVER_RESUME_CARD_W = 166;
    const EXPANDED_CARD_W = 340;

    if (visibleCuts.length === 0) {
      return {
        positionedCuts: [] as {
          cut: DockCutItem;
          leftPx: number;
          cardWidth: number;
          dotOffsetPx: number;
          segLeftPct: number;
          segWidthPct: number;
        }[],
        timelineTrackWidth: "100%",
      };
    }

    const isHoverResumeCut = (cut: DockCutItem) =>
      cut.cut_id !== selectedCutId &&
      cutResumePositions?.[cut.cut_id] !== undefined &&
      (hoveredCutId === cut.cut_id || focusedCutId === cut.cut_id);

    const scrubberWidth = scrubberMetrics?.width ?? 0;
    const trackViewportWidth =
      scrubberMetrics === null
        ? 720
        : scrubberWidth >= 380
          ? scrubberWidth
          : scrubberMetrics.rowWidth;
    const barWidth = scrubberWidth > 0 ? scrubberWidth : trackViewportWidth;

    // 1) Calcula largura máxima local centrada a partir dos pontos médios na barra
    const barAnchors = visibleCuts.map(
      (cut) => ((cut.start + cut.end) / 2 / safeDuration) * barWidth,
    );

    let minAnchorStep = barWidth;
    for (let i = 1; i < barAnchors.length; i++) {
      minAnchorStep = Math.min(minAnchorStep, barAnchors[i] - barAnchors[i - 1]);
    }
    const dynamicGap =
      visibleCuts.length <= 1
        ? 10
        : Math.max(4, Math.min(10, Math.floor(minAnchorStep * 0.14)));

    // 2) Layout base (sem expansão de hover/foco) para ancorar borda esquerda de referência
    const baseItems = visibleCuts.map((cut, i) => {
      const isSelected = cut.cut_id === selectedCutId;
      let baseWidth: number;
      if (isSelected) {
        baseWidth = EXPANDED_CARD_W;
      } else {
        const halfLeft =
          i > 0 ? (barAnchors[i] - barAnchors[i - 1] - dynamicGap) / 2 : barAnchors[i];
        const halfRight =
          i < visibleCuts.length - 1
            ? (barAnchors[i + 1] - barAnchors[i] - dynamicGap) / 2
            : barWidth - barAnchors[i];
        const leftNeed =
          i > 0 && visibleCuts[i - 1].cut_id === selectedCutId ? EXPANDED_CARD_W / 2 : 0;
        const maxHalfLeft =
          i > 0 && leftNeed > 0
            ? barAnchors[i] - (barAnchors[i - 1] + leftNeed + dynamicGap)
            : halfLeft;
        const rightNeed =
          i < visibleCuts.length - 1 && visibleCuts[i + 1].cut_id === selectedCutId
            ? EXPANDED_CARD_W / 2
            : 0;
        const maxHalfRight =
          i < visibleCuts.length - 1 && rightNeed > 0
            ? barAnchors[i + 1] - rightNeed - dynamicGap - barAnchors[i]
            : halfRight;
        const localMaxCenteredW = Math.max(
          MIN_COMPACT_CARD_W,
          Math.floor(2 * Math.min(halfLeft, halfRight, maxHalfLeft, maxHalfRight)),
        );
        const segSpanPx = (Math.max(0, cut.end - cut.start) / safeDuration) * barWidth;
        const preferredW = Math.max(
          Math.min(MINIMIZED_CARD_W, localMaxCenteredW),
          Math.round(segSpanPx),
        );
        baseWidth = Math.max(MIN_COMPACT_CARD_W, Math.min(preferredW, localMaxCenteredW));
      }

      const cardWidth = isHoverResumeCut(cut)
        ? Math.max(baseWidth, HOVER_RESUME_CARD_W)
        : baseWidth;
      const segLeftPct = Math.min(100, Math.max(0, (cut.start / safeDuration) * 100));
      const segWidthPct = Math.min(
        100 - segLeftPct,
        Math.max(1.2, ((cut.end - cut.start) / safeDuration) * 100),
      );
      return {
        cut,
        baseWidth,
        cardWidth,
        segLeftPct,
        segWidthPct,
      };
    });

    const baseTotalSpan = baseItems.reduce(
      (sum, item, idx) => sum + item.baseWidth + (idx > 0 ? dynamicGap : 0),
      0,
    );
    const baseTrackSpan = Math.max(trackViewportWidth || 720, baseTotalSpan);

    const anchors = baseItems.map((item) => {
      const midSec = (item.cut.start + item.cut.end) / 2;
      return Math.max(0, Math.min(baseTrackSpan, (midSec / safeDuration) * baseTrackSpan));
    });

    const baseLefts = new Array<number>(baseItems.length);
    for (let i = 0; i < baseItems.length; i++) {
      const desired = Math.max(
        0,
        Math.min(baseTrackSpan - baseItems[i].baseWidth, anchors[i] - baseItems[i].baseWidth / 2),
      );
      const minLeft = i === 0 ? 0 : baseLefts[i - 1] + baseItems[i - 1].baseWidth + dynamicGap;
      baseLefts[i] = Math.max(desired, minLeft);
    }
    const lastIdx = baseItems.length - 1;
    baseLefts[lastIdx] = Math.min(baseLefts[lastIdx], baseTrackSpan - baseItems[lastIdx].baseWidth);
    for (let i = lastIdx - 1; i >= 0; i--) {
      const maxLeft = baseLefts[i + 1] - dynamicGap - baseItems[i].baseWidth;
      baseLefts[i] = Math.min(baseLefts[i], maxLeft);
    }

    // 2) Expande cards em Retomar prioritariamente para a direita a partir de baseLefts[i]
    const totalCardsSpan = baseItems.reduce(
      (sum, item, idx) => sum + item.cardWidth + (idx > 0 ? dynamicGap : 0),
      0,
    );
    const trackSpan = Math.max(baseTrackSpan, totalCardsSpan);

    const lefts = [...baseLefts];
    for (let i = 1; i < baseItems.length; i++) {
      const minLeft = lefts[i - 1] + baseItems[i - 1].cardWidth + dynamicGap;
      lefts[i] = Math.max(lefts[i], minLeft);
    }
    lefts[lastIdx] = Math.min(lefts[lastIdx], trackSpan - baseItems[lastIdx].cardWidth);
    for (let i = lastIdx - 1; i >= 0; i--) {
      const maxLeft = lefts[i + 1] - dynamicGap - baseItems[i].cardWidth;
      lefts[i] = Math.min(lefts[i], maxLeft);
    }

    const positioned = baseItems.map((item, idx) => {
      const leftPx = Math.max(0, lefts[idx]);
      const dotOffsetPx = Math.max(10, Math.min(item.cardWidth - 10, anchors[idx] - leftPx));
      return {
        cut: item.cut,
        leftPx,
        cardWidth: item.cardWidth,
        dotOffsetPx,
        segLeftPct: item.segLeftPct,
        segWidthPct: item.segWidthPct,
      };
    });

    return {
      positionedCuts: positioned,
      timelineTrackWidth: `max(100%, ${Math.ceil(trackSpan)}px)`,
    };
  }, [
    visibleCuts,
    selectedCutId,
    hoveredCutId,
    focusedCutId,
    cutResumePositions,
    safeDuration,
    scrubberMetrics?.width,
    scrubberMetrics?.rowWidth,
  ]);

  useEffect(() => {
    if (collapsed || !selectedCutId) return;
    const scrollSelectedIntoView = () => {
      const container = timelineScrollRef.current;
      if (!container) return;
      const cards = container.querySelectorAll<HTMLElement>("[data-cut-card]");
      for (const card of cards) {
        if (card.getAttribute("data-cut-card") === selectedCutId) {
          card.scrollIntoView?.({ inline: "nearest", block: "nearest" });
          break;
        }
      }
    };
    const rafId = requestAnimationFrame(scrollSelectedIntoView);
    const settleTimer = window.setTimeout(scrollSelectedIntoView, 340);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(settleTimer);
    };
  }, [selectedCutId, collapsed, transcriptPinned, pinnedTranscriptSide, scrubberMetrics?.width]);

  const handleScrub = (clientX: number) => {
    if (!scrubberRef.current || duration <= 0) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  const lastErrorView = useMemo(() => formatLastError(jobLastError), [jobLastError]);
  const isProcessing =
    isActivelyProcessing !== undefined ? isActivelyProcessing : isJobProcessingStatus(jobStatus);
  const statusLabel = getHumanJobStatusLabel(jobStatus);
  const selectedCut = visibleCuts.find((c) => c.cut_id === selectedCutId) || null;
  const menuCut = cutMenuState
    ? visibleCuts.find((c) => c.cut_id === cutMenuState.cutId) ?? null
    : null;

  const resolvedSpeedSteps = speedSteps.length > 0 ? speedSteps : DEFAULT_SPEED_STEPS;
  const speedLabel = `${playbackRate}x`;
  const dockBottom = "12px";
  const isNarrowDock = false;
  const dockLeft =
    sidebarPinned && sidebarSide !== "right" ? "calc(var(--sidebar-w) + 24px)" : "12px";
  const dockRight =
    sidebarPinned && sidebarSide === "right" ? "calc(var(--sidebar-w) + 24px)" : "12px";

  return (
    <>
      {collapsed && effectiveMinimizedHidden && (
        <div
          aria-hidden="true"
          onMouseEnter={(e) => {
            lastPointerRef.current = { x: e.clientX, y: e.clientY };
            clearHideTimer();
            isDockHoveredRef.current = true;
            setMinimizedHidden(false);
            onVisibilityChangeRef.current?.(true);
          }}
          className="fixed z-dock bottom-0"
          style={{
            left: dockLeft,
            right: dockRight,
            bottom: "0px",
            height: "calc(var(--dock-h-collapsed) + var(--dock-gap))",
          }}
        />
      )}

      <section
        ref={sectionRef}
        aria-label="Controles e timeline"
        data-collapsed={collapsed ? "true" : "false"}
        onMouseEnter={handleDockMouseEnter}
        onMouseLeave={handleDockMouseLeave}
        className={[
          "fixed z-dock glass transition-[bottom,left,right,height,border-radius,opacity,transform] duration-slow ease-out overflow-visible",
          transcriptAboveDock && !(collapsed && effectiveMinimizedHidden)
            ? "rounded-b-panel rounded-t-none border-t-0"
            : "rounded-panel",
          collapsed && effectiveMinimizedHidden
            ? "opacity-0 translate-y-4 pointer-events-none"
            : "opacity-100 translate-y-0",
        ].join(" ")}
        style={{
          bottom: dockBottom,
          left: dockLeft,
          right: dockRight,
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
          "absolute left-1/2 -translate-x-1/2 z-10 grid w-7 place-items-center text-text-3 hover:text-text-1 transition-[color,transform,top,bottom] duration-base ease-out",
          collapsed ? "top-1 h-4" : "bottom-0.5 h-3.5",
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

      <div
        className={[
          "h-full px-4 flex flex-col justify-between gap-2",
          collapsed ? "py-3" : "pt-3 pb-3",
        ].join(" ")}
      >
        {/* Linha de reprodução (sempre visível) */}
        <div ref={playbackRowRef} className="flex items-center gap-3 h-8 shrink-0">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? "Pausar" : "Reproduzir"}
              className="grid h-8 w-8 place-items-center rounded-pill text-text-1 hover:bg-glass-hover transition-colors duration-fast shrink-0"
            >
              {isPlaying ? <Pause size={20} weight="regular" /> : <Play size={20} weight="regular" />}
            </button>

            {!collapsed && (
              <>
                <button
                  type="button"
                  onClick={onPrevCut}
                  disabled={visibleCuts.length === 0}
                  aria-label="Corte anterior"
                  className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 transition-colors duration-fast shrink-0"
                >
                  <SkipBack size={16} weight="regular" />
                </button>

                <button
                  type="button"
                  onClick={onNextCut}
                  disabled={visibleCuts.length === 0}
                  aria-label="Próximo corte"
                  className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 transition-colors duration-fast shrink-0"
                >
                  <SkipForward size={16} weight="regular" />
                </button>
              </>
            )}
          </div>

          <button
            ref={speedMenuTriggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (speedMenuState) {
                setSpeedMenuState(null);
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const menuWidth = 96;
              const estimatedMenuHeight = resolvedSpeedSteps.length * 24 + 8;
              const left = Math.max(
                8,
                Math.min(window.innerWidth - menuWidth - 8, rect.left),
              );
              const fitsBelow = rect.bottom + 6 + estimatedMenuHeight <= window.innerHeight - 8;
              setSpeedMenuState(
                fitsBelow
                  ? {
                      top: rect.bottom + 6,
                      left,
                      openUpward: false,
                    }
                  : {
                      bottom: window.innerHeight - rect.top + 6,
                      left,
                      openUpward: true,
                    },
              );
            }}
            aria-label="Velocidade de reprodução"
            aria-haspopup="menu"
            aria-expanded={Boolean(speedMenuState)}
            className="h-7 px-2.5 rounded-pill inline-flex items-center gap-1 bg-white/[0.06] border border-line text-sm text-text-1 tabular-nums hover:bg-glass-hover transition-colors duration-fast shrink-0"
          >
            <span>{speedLabel}</span>
            <CaretDown
              size={11}
              weight="regular"
              className={[
                "text-text-2 transition-transform duration-fast",
                speedMenuState ? "rotate-180" : "rotate-0",
              ].join(" ")}
            />
          </button>

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
            <div className="relative w-full h-[6px] group-hover:h-[8px] rounded-pill bg-white/[0.18] transition-[height] duration-fast">
              {!isImmersive &&
                positionedCuts.map(({ cut, segLeftPct, segWidthPct }) => {
                  const isCutRendering =
                    !cut.renderedFileName &&
                    Boolean(isRenderingCuts) &&
                    cut.status !== "rejected";
                  return (
                    <button
                      key={cut.cut_id}
                      type="button"
                      data-enter-watch="true"
                      aria-label={`Ir para corte ${cut.title || ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = scrubberRef.current?.getBoundingClientRect();
                        const clickedTime =
                          rect && rect.width > 0 && duration > 0
                            ? Math.min(
                                duration,
                                Math.max(
                                  0,
                                  ((e.clientX - rect.left) / rect.width) * duration,
                                ),
                              )
                            : cut.start;
                        if (cut.cut_id === selectedCutId) {
                          onSeek(clickedTime);
                        } else {
                          onSelectCut(cut.cut_id, { seekTo: clickedTime });
                        }
                      }}
                      className={[
                        "absolute inset-y-0 rounded-pill transition-colors duration-fast",
                        isCutRendering
                          ? cut.cut_id === selectedCutId
                            ? "bg-[var(--cut-rendering-strong)] shadow-[0_0_8px_rgba(249,115,22,0.65)] z-[1]"
                            : "bg-[var(--cut-rendering)] hover:bg-[var(--cut-rendering-strong)]"
                          : cut.cut_id === selectedCutId
                            ? "bg-accent shadow-[0_0_8px_rgba(59,130,246,0.65)] z-[1]"
                            : "bg-accent-seg hover:bg-accent",
                      ].join(" ")}
                      style={{ left: `${segLeftPct}%`, width: `${segWidthPct}%` }}
                    />
                  );
                })}

              <div
                className="absolute inset-y-0 left-0 z-[2] rounded-pill bg-white/90 pointer-events-none"
                style={{ width: `${progressPct}%` }}
              />

              <div
                className="absolute top-1/2 z-[3] h-3 w-3 rounded-pill bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] -translate-x-1/2 -translate-y-1/2 scale-0 group-hover:scale-100 group-focus-visible:scale-100 transition-transform duration-fast ease-out pointer-events-none"
                style={{ left: `${progressPct}%` }}
              />
            </div>
          </div>

          {!collapsed && (
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
          )}
        </div>

        {/* Timeline com cartões de corte (oculto quando recolhido) */}
        <div
          className={[
            "flex items-start flex-1 min-h-0 transition-opacity duration-base",
            collapsed ? "opacity-0 pointer-events-none hidden" : "opacity-100",
          ].join(" ")}
        >
          {/* Área rolável dos cartões alinhada diretamente sob a barra de progressão */}
          <div
            ref={timelineScrollRef}
            className="overflow-x-auto overflow-y-hidden no-scrollbar snap-x snap-proximity h-full shrink-0"
            style={
              scrubberMetrics && scrubberMetrics.width >= 380
                ? {
                    marginLeft: `${scrubberMetrics.offsetLeft}px`,
                    width: `${scrubberMetrics.width}px`,
                  }
                : { width: "100%" }
            }
          >
            <div className="relative h-full" style={{ width: timelineTrackWidth }}>
              {/* Cartões posicionados pelo tempo real */}
              <div className="relative h-[136px] mt-0.5">
                {positionedCuts.length === 0 ? (
                  isProcessing || jobStatus === "ERROR" || jobError ? null : (
                    <div
                      className="sticky left-0 h-full flex items-center justify-center text-center text-xs text-text-3"
                      style={{ width: scrubberMetrics && scrubberMetrics.width >= 380 ? `${scrubberMetrics.width}px` : "100%" }}
                    >
                      Nenhum corte gerado ainda. Clique em Gerar cortes.
                    </div>
                  )
                ) : (
                  positionedCuts.map(({ cut, leftPx, cardWidth, dotOffsetPx }) => {
                    const isSelected = cut.cut_id === selectedCutId;
                    const isReady = Boolean(cut.renderedFileName);
                    const isRejected = cut.status === "rejected";
                    const isApproved = cut.status === "approved";
                    const isCutRendering = !isReady && Boolean(isRenderingCuts) && !isRejected;
                    const resumePos = cutResumePositions?.[cut.cut_id];
                    const isHoverResume =
                      !isSelected &&
                      resumePos !== undefined &&
                      (hoveredCutId === cut.cut_id || focusedCutId === cut.cut_id);
                    const isCompactMini = !isSelected && !isHoverResume && cardWidth < 56;
                    const statusText = isReady
                      ? "Pronto"
                      : isApproved
                        ? "Aprovado"
                        : isRejected
                          ? "Descartado"
                          : "Sugerido";
                    const cutDuration = Math.max(0, cut.end - cut.start);
                    const thumbUrl = videoSrc ? `${videoSrc}#t=${Math.floor(cut.start)}` : undefined;
                    const thumbnailEl = (
                      <div
                        className={[
                          "relative aspect-square shrink-0 rounded-[8px] overflow-hidden bg-black/50 border border-line transition-[width,height] duration-slow ease-out",
                          isSelected ? "w-16 h-16" : isCompactMini ? "w-8 h-8" : "w-10 h-10",
                        ].join(" ")}
                      >
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
                    );

                    return (
                      <div
                        key={cut.cut_id}
                        data-cut-card={cut.cut_id}
                        data-enter-watch="true"
                        data-selected={isSelected ? "true" : "false"}
                        data-status={isRejected ? "descartado" : statusText.toLowerCase()}
                        onMouseEnter={() => setHoveredCutId(cut.cut_id)}
                        onMouseLeave={() =>
                          setHoveredCutId((prev) => (prev === cut.cut_id ? null : prev))
                        }
                        onFocus={() => {
                          if (!isSelected && resumePos !== undefined) {
                            setFocusedCutId(cut.cut_id);
                          }
                        }}
                        onBlur={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                            setFocusedCutId((prev) => (prev === cut.cut_id ? null : prev));
                          }
                        }}
                        style={{ left: `${leftPx}px`, width: `${cardWidth}px` }}
                        className={[
                          "absolute top-4 snap-start rounded-card border flex flex-col transition-[left,width,opacity,background-color,border-color,box-shadow] duration-slow ease-out",
                          isSelected
                            ? "min-h-[96px] p-3 -translate-y-0.5 bg-[rgba(91,156,255,0.10)] border-transparent shadow-[0_0_0_1.5px_var(--accent-ring),var(--shadow-card)] z-10"
                            : isHoverResume
                              ? "h-[70px] p-0 bg-white/[0.08] border-line-strong shadow-card"
                              : "h-[70px] p-0 bg-white/[0.05] border-line shadow-card hover:bg-white/[0.08] hover:border-line-strong",
                          isRejected
                            ? "opacity-35 grayscale"
                            : isSelected
                              ? "opacity-100"
                              : isHoverResume
                                ? "opacity-95"
                                : "opacity-55 hover:opacity-90",
                        ].join(" ")}
                      >
                        {/* Ponto + linha de 1px ligando à faixa */}
                        <span
                          aria-hidden="true"
                          className={[
                            "absolute -top-2.5 -translate-x-1/2 w-[1px] h-2",
                            isCutRendering ? "bg-[var(--cut-rendering)]" : "bg-accent-soft/60",
                          ].join(" ")}
                          style={{ left: `${dotOffsetPx}px` }}
                        />
                        <span
                          aria-hidden="true"
                          className={[
                            "absolute -top-3 -translate-x-1/2 w-1.5 h-1.5 rounded-pill",
                            isCutRendering ? "bg-[var(--cut-rendering-strong)]" : "bg-accent-soft",
                          ].join(" ")}
                          style={{ left: `${dotOffsetPx}px` }}
                        />

                        {isSelected ? (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              data-enter-watch="true"
                              onClick={() => {
                                setHoveredCutId(null);
                                setFocusedCutId(null);
                                onSelectCut(cut.cut_id);
                                onSeek(cut.start);
                              }}
                              aria-label={`Tocar corte ${cut.title || "sugerido"} do início`}
                              title={`Tocar do início (${formatShortTime(cut.start)})`}
                              className="shrink-0 rounded-[8px] cursor-pointer hover:brightness-110 transition-[filter] duration-fast"
                            >
                              {thumbnailEl}
                            </button>

                            <div className="min-w-0 flex-1 flex flex-col min-h-[68px] justify-between gap-2.5">
                              <div className="flex items-start justify-between gap-1.5">
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
                                      e.stopPropagation();
                                      if (e.key === "Enter") {
                                        if (editingTitleValue.trim()) {
                                          onRenameCut(cut.cut_id, editingTitleValue.trim());
                                        }
                                        setEditingTitleId(null);
                                      }
                                      if (e.key === "Escape") setEditingTitleId(null);
                                    }}
                                    className="flex-1 min-w-0 px-1 py-0.5 rounded bg-black/60 border border-line-strong text-xs text-text-1 focus-visible:ring-2 focus-visible:ring-accent-ring"
                                  />
                                ) : (
                                  <p
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setEditingTitleId(cut.cut_id);
                                      setEditingTitleValue(cut.title || "Corte");
                                    }}
                                    className="text-xs font-medium text-text-1 leading-tight line-clamp-2 flex-1 min-w-0"
                                  >
                                    {cut.title || "Corte sugerido"}
                                  </p>
                                )}

                                <button
                                  type="button"
                                  ref={
                                    cutMenuState?.cutId === cut.cut_id
                                      ? cutMenuTriggerRef
                                      : undefined
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (cutMenuState?.cutId === cut.cut_id) {
                                      setCutMenuState(null);
                                      return;
                                    }
                                    cutMenuTriggerRef.current = e.currentTarget;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const menuWidth = 152;
                                    const estimatedMenuHeight = 84;
                                    const left = Math.max(
                                      8,
                                      Math.min(window.innerWidth - menuWidth - 8, rect.right + 6),
                                    );
                                    const fitsBelowTop =
                                      rect.top + estimatedMenuHeight <= window.innerHeight - 8;
                                    setCutMenuState(
                                      fitsBelowTop
                                        ? {
                                            cutId: cut.cut_id,
                                            top: Math.max(8, rect.top),
                                            left,
                                          }
                                        : {
                                            cutId: cut.cut_id,
                                            bottom: Math.max(8, window.innerHeight - rect.bottom),
                                            left,
                                          },
                                    );
                                  }}
                                  aria-label="Ações do corte"
                                  aria-expanded={cutMenuState?.cutId === cut.cut_id}
                                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-2 hover:text-text-1 hover:bg-white/[0.08] transition-colors duration-fast"
                                >
                                  <DotsThreeVertical size={15} weight="regular" />
                                </button>
                              </div>

                              <div
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                                className="flex items-center justify-start gap-2"
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectCut(cut.cut_id);
                                    onSeek(cut.start);
                                  }}
                                  aria-label="Voltar corte do início"
                                  title="Voltar corte do início"
                                  className="mr-1 grid h-[17px] w-[17px] shrink-0 place-items-center rounded bg-white/[0.08] text-text-1 border border-transparent hover:border-accent-soft/45 hover:bg-accent/25 hover:text-accent-soft hover:scale-105 active:scale-95 transition-[background-color,border-color,color,transform] duration-fast cursor-pointer"
                                >
                                  <ArrowCounterClockwise size={12} weight="regular" />
                                </button>

                                <div className="inline-flex items-center gap-0.5 min-w-0">
                                  <span className="text-[10px] text-text-3 mr-0.5">Início</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAdjustCutTime(cut.cut_id, "start", -1);
                                    }}
                                    aria-label="Diminuir início 1 segundo"
                                    className="grid h-[17px] w-[17px] place-items-center rounded bg-white/[0.08] text-text-1 border border-transparent hover:border-accent-soft/45 hover:bg-accent/25 hover:text-accent-soft hover:scale-105 active:scale-95 transition-[background-color,border-color,color,transform] duration-fast"
                                  >
                                    <Minus size={10} weight="regular" />
                                  </button>
                                  <span className="text-[11px] text-text-1 tabular-nums px-0.5">
                                    {formatShortTime(cut.start)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAdjustCutTime(cut.cut_id, "start", 1);
                                    }}
                                    aria-label="Avançar início 1 segundo"
                                    className="grid h-[17px] w-[17px] place-items-center rounded bg-white/[0.08] text-text-1 border border-transparent hover:border-accent-soft/45 hover:bg-accent/25 hover:text-accent-soft hover:scale-105 active:scale-95 transition-[background-color,border-color,color,transform] duration-fast"
                                  >
                                    <Plus size={10} weight="regular" />
                                  </button>
                                </div>

                                <div className="inline-flex items-center gap-0.5 min-w-0">
                                  <span className="text-[10px] text-text-3 mr-0.5">Fim</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAdjustCutTime(cut.cut_id, "end", -1);
                                    }}
                                    aria-label="Diminuir fim 1 segundo"
                                    className="grid h-[17px] w-[17px] place-items-center rounded bg-white/[0.08] text-text-1 border border-transparent hover:border-accent-soft/45 hover:bg-accent/25 hover:text-accent-soft hover:scale-105 active:scale-95 transition-[background-color,border-color,color,transform] duration-fast"
                                  >
                                    <Minus size={10} weight="regular" />
                                  </button>
                                  <span className="text-[11px] text-text-1 tabular-nums px-0.5">
                                    {formatShortTime(cut.end)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAdjustCutTime(cut.cut_id, "end", 1);
                                    }}
                                    aria-label="Avançar fim 1 segundo"
                                    className="grid h-[17px] w-[17px] place-items-center rounded bg-white/[0.08] text-text-1 border border-transparent hover:border-accent-soft/45 hover:bg-accent/25 hover:text-accent-soft hover:scale-105 active:scale-95 transition-[background-color,border-color,color,transform] duration-fast"
                                  >
                                    <Plus size={10} weight="regular" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="h-full overflow-hidden rounded-card flex items-stretch w-full">
                            <button
                              type="button"
                              data-enter-watch="true"
                              onClick={() => {
                                setHoveredCutId(null);
                                setFocusedCutId(null);
                                onSelectCut(cut.cut_id);
                                onSeek(cut.start);
                              }}
                              aria-label={`Selecionar e tocar corte ${cut.title || "sugerido"} (${formatShortTime(cutDuration)})`}
                              title={
                                !isHoverResume
                                  ? `${cut.title || "Corte sugerido"} (${formatShortTime(cutDuration)})`
                                  : `Tocar do início (${formatShortTime(cut.start)})`
                              }
                              className={[
                                "h-full flex items-center justify-center transition-colors duration-fast cursor-pointer",
                                isHoverResume
                                  ? "p-1.5 w-[62px] shrink-0 hover:bg-white/[0.06]"
                                  : isCompactMini
                                    ? "p-1 w-full flex-col gap-0.5"
                                    : "p-1.5 w-full flex-col gap-1",
                              ].join(" ")}
                            >
                              {thumbnailEl}
                              {!isHoverResume && (
                                <div className="w-full flex items-center justify-center text-[10px] leading-none text-text-3 tabular-nums">
                                  <span className="truncate">{formatShortTime(cutDuration)}</span>
                                </div>
                              )}
                            </button>

                            {isHoverResume && (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="w-[1px] self-stretch bg-white/[0.12] shrink-0"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHoveredCutId(null);
                                    setFocusedCutId(null);
                                    onResumeCut?.(cut.cut_id);
                                  }}
                                  title={`Retomar de ${formatShortTime(resumePos)}`}
                                  className="flex-1 self-stretch px-2.5 flex items-center justify-center gap-1.5 text-xs font-medium text-text-1 bg-transparent hover:bg-accent/25 hover:text-accent-soft active:bg-accent/35 focus-visible:ring-inset transition-colors duration-fast cursor-pointer"
                                >
                                  <Play size={12} weight="fill" />
                                  <span>Retomar</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
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
            "flex items-center justify-between min-h-9 shrink-0 transition-opacity duration-base",
            isNarrowDock ? "flex-nowrap gap-2" : "flex-wrap gap-3 gap-y-2",
            collapsed ? "opacity-0 pointer-events-none hidden" : "opacity-100",
          ].join(" ")}
        >
          {/* Esquerda: status de erro/processamento (quando sem seleção) OU ações do corte */}
          <div
            className={[
              "flex items-center min-w-0",
              isNarrowDock ? "gap-1" : "gap-1.5",
            ].join(" ")}
          >
            {!selectedCut && (jobStatus === "ERROR" || jobError) ? (
              <div className="inline-flex items-center gap-2 px-3 h-7 rounded-pill bg-[var(--danger-bg)] border border-danger/30 text-xs text-danger truncate">
                <span
                  className="truncate"
                  title={lastErrorView?.full ?? getHumanErrorMessage(jobError)}
                >
                  {lastErrorView?.text ?? getHumanErrorMessage(jobError)}
                </span>
                <button
                  type="button"
                  onClick={onRetryError}
                  className="inline-flex items-center gap-1 font-medium underline shrink-0 whitespace-nowrap"
                >
                  <ArrowCounterClockwise size={12} />
                  <span>Tentar de novo</span>
                </button>
                {onOpenLogs && (
                  <button
                    type="button"
                    onClick={onOpenLogs}
                    title="Abrir a pasta com os logs deste erro"
                    className="inline-flex items-center gap-1 font-medium underline shrink-0 whitespace-nowrap"
                  >
                    <FolderOpen size={12} />
                    <span>Exibir logs</span>
                  </button>
                )}
              </div>
            ) : !selectedCut && isProcessing && statusLabel ? (
              <div className="inline-flex items-center gap-2 text-sm text-text-2 min-w-0">
                <SpinnerGap
                  size={14}
                  weight="regular"
                  className="shrink-0 text-text-1 animate-spin"
                  aria-hidden="true"
                />
                <span className="truncate">{statusLabel}</span>
                <button
                  type="button"
                  onClick={onCancelProcessing}
                  className="text-xs text-text-3 hover:text-text-1 underline shrink-0 whitespace-nowrap"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!selectedCut}
                  title={!selectedCut ? "Selecione um corte" : undefined}
                  onClick={() => selectedCut && onWatchCut(selectedCut)}
                  className={[
                    "h-7 rounded-pill inline-flex items-center text-sm bg-white/[0.06] border border-line text-text-1 enabled:hover:bg-white/[0.12] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast whitespace-nowrap shrink-0",
                    isNarrowDock ? "px-2 gap-1" : "px-2.5 gap-1.5",
                  ].join(" ")}
                >
                  <Play size={13} weight="regular" />
                  <span>Assistir</span>
                </button>

                <button
                  type="button"
                  disabled={!selectedCut}
                  title={!selectedCut ? "Selecione um corte" : undefined}
                  onClick={() => selectedCut && onApproveCut(selectedCut.cut_id)}
                  className={[
                    "h-7 rounded-pill inline-flex items-center text-sm border transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0",
                    isNarrowDock ? "px-2 gap-1" : "px-2.5 gap-1.5",
                    selectedCut?.status === "approved"
                      ? "bg-accent/20 border-accent-soft/40 text-text-1"
                      : "bg-white/[0.06] border-line text-text-1 enabled:hover:bg-white/[0.12]",
                  ].join(" ")}
                >
                  <Check size={13} weight="regular" className="text-success" />
                  <span>Aprovar</span>
                </button>

                <button
                  type="button"
                  disabled={!selectedCut}
                  title={!selectedCut ? "Selecione um corte" : undefined}
                  onClick={() => selectedCut && onDiscardCut(selectedCut.cut_id)}
                  className={[
                    "h-7 rounded-pill inline-flex items-center text-sm bg-white/[0.06] border border-line text-text-1 enabled:hover:bg-[var(--danger-bg)] enabled:hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast whitespace-nowrap shrink-0",
                    isNarrowDock ? "px-2 gap-1" : "px-2.5 gap-1.5",
                  ].join(" ")}
                >
                  <X size={13} weight="regular" />
                  <span>Descartar</span>
                </button>
              </>
            )}
          </div>

          {/* Direita: Terminal + Revisar antes + Gerar cortes */}
          <div
            className={[
              "flex items-center shrink-0",
              isNarrowDock ? "gap-1.5" : "gap-2.5",
            ].join(" ")}
          >
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setTerminalOpen((o) => !o)}
                aria-expanded={terminalOpen}
                className={[
                  "h-9 rounded-pill inline-flex items-center border text-base text-text-1 transition-colors duration-fast whitespace-nowrap shrink-0",
                  terminalOpen
                    ? "bg-glass-active border-line"
                    : "bg-white/[0.06] border-line hover:bg-glass-hover",
                  isNarrowDock ? "px-2.5" : "px-3.5",
                ].join(" ")}
              >
                {terminalOpen ? "Ocultar terminal" : "Exibir terminal"}
              </button>

              {terminalOpen && (
                <TerminalPanel
                  jobId={activeJobId}
                  isProcessing={isProcessing}
                  onClose={() => setTerminalOpen(false)}
                />
              )}
            </div>

            <div
              className={[
                "h-9 rounded-pill inline-flex items-center bg-white/[0.06] border border-line whitespace-nowrap shrink-0",
                isNarrowDock ? "px-2.5 gap-1.5" : "px-3 gap-2",
              ].join(" ")}
            >
              <span className="text-sm text-text-1 select-none whitespace-nowrap">Revisar antes</span>
              <button
                type="button"
                role="switch"
                aria-checked={reviewBeforeRender}
                aria-label="Revisar antes"
                onClick={onToggleReviewBefore}
                className={[
                  "relative w-9 h-5 rounded-pill transition-colors duration-base ease-out shrink-0",
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
                className={[
                  "h-9 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active active:scale-[0.98] transition-[background-color,transform] duration-fast whitespace-nowrap shrink-0",
                  isNarrowDock ? "px-3" : "px-4",
                ].join(" ")}
              >
                Renderizar aprovados
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing}
                onClick={onGenerateCuts}
                className={[
                  "h-9 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed transition-[background-color,transform] duration-fast whitespace-nowrap shrink-0",
                  isNarrowDock ? "px-3" : "px-4",
                ].join(" ")}
              >
                {isProcessing ? "Processando…" : "Gerar cortes"}
              </button>
            )}
          </div>
        </div>
      </div>
      </section>

      {cutMenuState &&
        menuCut &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={cutMenuPopoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: `${cutMenuState.left}px`,
              ...(cutMenuState.bottom !== undefined
                ? { bottom: `${cutMenuState.bottom}px` }
                : { top: `${cutMenuState.top}px` }),
              width: "152px",
            }}
            className={[
              "z-popover rounded-card glass--strong p-1.5 shadow-pop space-y-0.5 transition-[opacity,transform] duration-[120ms] ease-out",
              cutMenuEntered ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-1",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => {
                setCutMenuState(null);
                onDeleteCut?.(menuCut.cut_id);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-danger hover:bg-[var(--danger-bg)] transition-colors duration-fast"
            >
              <Trash size={13} weight="regular" />
              <span>Apagar</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCutMenuState(null);
                if (menuCut.renderedFileName) {
                  onOpenRenderedFolder(menuCut.renderedFileName);
                } else {
                  onOpenVideoFolder?.();
                }
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-1 hover:bg-glass-hover transition-colors duration-fast"
            >
              <FolderOpen size={13} weight="regular" />
              <span>Abrir pasta</span>
            </button>
          </div>,
          document.body,
        )}

      {speedMenuState &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={speedMenuPopoverRef}
            role="menu"
            aria-label="Velocidade de reprodução"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: `${speedMenuState.left}px`,
              ...(speedMenuState.bottom !== undefined
                ? { bottom: `${speedMenuState.bottom}px` }
                : { top: `${speedMenuState.top}px` }),
              width: "96px",
            }}
            className={[
              "z-popover rounded-card glass--strong p-1 shadow-pop flex flex-col transition-[opacity,transform] duration-[120ms] ease-out",
              speedMenuEntered
                ? "opacity-100 translate-y-0"
                : speedMenuState.openUpward
                  ? "opacity-0 translate-y-1"
                  : "opacity-0 -translate-y-1",
            ].join(" ")}
          >
            {resolvedSpeedSteps.map((step) => {
              const isActive = Math.abs(playbackRate - step) < 0.001;
              return (
                <button
                  key={step}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    if (onSelectSpeed) {
                      onSelectSpeed(step);
                    } else {
                      onCycleSpeed();
                    }
                    setSpeedMenuState(null);
                  }}
                  className={[
                    "w-full flex items-center justify-between gap-2 px-2.5 py-1 rounded-thumb text-xs tabular-nums transition-colors duration-fast",
                    isActive
                      ? "bg-glass-active text-accent-soft font-medium"
                      : "text-text-2 hover:bg-glass-hover hover:text-text-1",
                  ].join(" ")}
                >
                  <span>{`${step}x`}</span>
                  {isActive && <Check size={12} weight="bold" className="text-accent-soft shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
