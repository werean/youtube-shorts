import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  DownloadSimple,
  Eye,
  EyeSlash,
  PushPin,
  X,
} from "@phosphor-icons/react";
import type { Segment } from "../../types";
import { formatShortTime } from "./presets";

export type TranscriptSlot =
  | "beside-sidebar"
  | "opposite-edge"
  | "above-dock";

export const TRANSCRIPT_FONT_SIZE_MIN = 13;
export const TRANSCRIPT_FONT_SIZE_MAX = 24;
export const TRANSCRIPT_FONT_SIZE_DEFAULT = 16;

export const TRANSCRIPT_BLACK_BG_OPACITY_MIN = 15;
export const TRANSCRIPT_BLACK_BG_OPACITY_MAX = 90;
export const TRANSCRIPT_BLACK_BG_OPACITY_DEFAULT = 45;

export interface TranscriptFreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TranscriptPopoverProps {
  open: boolean;
  pinned?: boolean;
  dockCollapsed?: boolean;
  sidebarPinned?: boolean;
  sidebarOpen?: boolean;
  sidebarSide?: "left" | "right";
  hiddenWithSidebar?: boolean;
  videoKey?: string;
  transcriptionText: string;
  segments: Segment[];
  blocks: Record<string, unknown>[];
  showDiscardedCuts: boolean;
  discardedCount: number;
  currentTime?: number;
  isPlaying?: boolean;
  placementSlot?: TranscriptSlot;
  freeRect?: TranscriptFreeRect | null;
  transparentOverVideo?: boolean;
  fontSizePx?: number;
  blackOverVideoBg?: boolean;
  blackOverVideoOpacity?: number;
  onTogglePin?: () => void;
  onToggleShowDiscarded: () => void;
  onSeekTo: (seconds: number) => void;
  onClose: () => void;
  onPlacementChange?: (next: {
    slot: TranscriptSlot;
    freeRect: TranscriptFreeRect | null;
  }) => void;
  onTransparentOverVideoChange?: (next: boolean) => void;
  onAttachedHoverChange?: (hovered: boolean) => void;
}

type TranscriptTab = "transcript" | "blocks";
type TextPhase = "idle" | "out" | "in";
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ContentSnapshot {
  videoKey: string | undefined;
  tab: TranscriptTab;
  transcriptionText: string;
  segments: Segment[];
  blocks: Record<string, unknown>[];
}

const DRAG_THRESHOLD_PX = 4;
const TRANSPARENT_DELAY_MS = 1500;
const MANUAL_SCROLL_PAUSE_MS = 2500;
const MIN_FREE_WIDTH = 220;
const MIN_FREE_HEIGHT = 140;
const VIEWPORT_MARGIN_PX = 8;

const RESIZE_CURSORS: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getCssPxVar(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSidebarWidthPx(): number {
  const fallback =
    typeof window !== "undefined" && window.innerWidth <= 1024 ? 220 : 260;
  return getCssPxVar("--sidebar-w", fallback);
}

function clampRectToViewport(
  rect: TranscriptFreeRect,
  bounds?: { minWidth?: number; minHeight?: number },
): TranscriptFreeRect {
  if (typeof window === "undefined") return rect;
  const minWidth = bounds?.minWidth ?? MIN_FREE_WIDTH;
  const minHeight = bounds?.minHeight ?? MIN_FREE_HEIGHT;
  const maxW = Math.max(
    minWidth,
    window.innerWidth - VIEWPORT_MARGIN_PX * 2,
  );
  const maxH = Math.max(
    minHeight,
    window.innerHeight - VIEWPORT_MARGIN_PX * 2,
  );
  const width = clamp(rect.width, minWidth, maxW);
  const height = clamp(rect.height, minHeight, maxH);
  const x = clamp(
    rect.x,
    VIEWPORT_MARGIN_PX,
    Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX),
  );
  const y = clamp(
    rect.y,
    VIEWPORT_MARGIN_PX,
    Math.max(
      VIEWPORT_MARGIN_PX,
      window.innerHeight - height - VIEWPORT_MARGIN_PX,
    ),
  );
  return { x, y, width, height };
}

function computeResizedRect(
  origin: TranscriptFreeRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
): TranscriptFreeRect {
  if (typeof window === "undefined") return origin;

  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;

  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;

  if (edge.includes("w")) {
    const minLeft = VIEWPORT_MARGIN_PX;
    const maxLeft = right - MIN_FREE_WIDTH;
    x = clamp(origin.x + dx, minLeft, maxLeft);
    width = right - x;
  } else if (edge.includes("e")) {
    const maxWidth = window.innerWidth - VIEWPORT_MARGIN_PX - origin.x;
    width = clamp(origin.width + dx, MIN_FREE_WIDTH, Math.max(MIN_FREE_WIDTH, maxWidth));
  }

  if (edge.includes("n")) {
    const minTop = VIEWPORT_MARGIN_PX;
    const maxTop = bottom - MIN_FREE_HEIGHT;
    y = clamp(origin.y + dy, minTop, maxTop);
    height = bottom - y;
  } else if (edge.includes("s")) {
    const maxHeight = window.innerHeight - VIEWPORT_MARGIN_PX - origin.y;
    height = clamp(
      origin.height + dy,
      MIN_FREE_HEIGHT,
      Math.max(MIN_FREE_HEIGHT, maxHeight),
    );
  }

  return { x, y, width, height };
}

function detectDropSlot(params: {
  clientX: number;
  clientY: number;
  sidebarSide: "left" | "right";
  sidebarVisible: boolean;
}): TranscriptSlot | null {
  if (typeof window === "undefined") return null;

  const { clientX, clientY, sidebarSide, sidebarVisible } = params;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sidebarW = getSidebarWidthPx();
  const rawStageRect = document
    .querySelector("main[data-video-stage]")
    ?.getBoundingClientRect();
  const stageRect =
    rawStageRect && rawStageRect.width > 0 && rawStageRect.height > 0
      ? rawStageRect
      : undefined;
  const dockRect = document
    .querySelector("section[aria-label='Controles e timeline']")
    ?.getBoundingClientRect();

  const dockTop = dockRect
    ? dockRect.top
    : vh - getCssPxVar("--dock-h", 256) - 12;

  const sidebarLeftBound = stageRect
    ? Math.max(stageRect.left, sidebarW + 24)
    : sidebarW + 24;
  const sidebarRightBound = stageRect
    ? Math.min(stageRect.right, vw - sidebarW - 24)
    : vw - sidebarW - 24;

  const oppositeRightBound =
    stageRect && stageRect.right < vw ? stageRect.right : vw - 14;
  const oppositeLeftBound =
    stageRect && stageRect.left > 0 ? stageRect.left : 14;

  const aboveLeftBound = stageRect
    ? sidebarVisible && sidebarSide === "left"
      ? Math.max(stageRect.left, sidebarW + 24)
      : stageRect.left
    : sidebarVisible && sidebarSide === "left"
      ? sidebarW + 24
      : 12;
  const aboveRightBound = stageRect
    ? sidebarVisible && sidebarSide === "right"
      ? Math.min(stageRect.right, vw - sidebarW - 24)
      : stageRect.right
    : sidebarVisible && sidebarSide === "right"
      ? vw - sidebarW - 24
      : vw - 12;
  const aboveTopBound =
    stageRect && stageRect.bottom < dockTop ? stageRect.bottom : dockTop - 14;
  const aboveBottomBound = dockRect ? dockRect.bottom : vh - 12;

  if (
    clientX > aboveLeftBound &&
    clientX < aboveRightBound &&
    clientY >= aboveTopBound &&
    clientY <= aboveBottomBound
  ) {
    return "above-dock";
  }

  const verticalBottomLimit = dockRect ? dockRect.top + 20 : vh;

  if (
    sidebarVisible &&
    (sidebarSide === "left"
      ? clientX <= sidebarLeftBound
      : clientX >= sidebarRightBound) &&
    clientY < verticalBottomLimit
  ) {
    return "beside-sidebar";
  }

  if (
    (sidebarSide === "left"
      ? clientX >= oppositeRightBound
      : clientX <= oppositeLeftBound) &&
    clientY < verticalBottomLimit
  ) {
    return "opposite-edge";
  }

  return null;
}

function isRectOverVideoStage(rect: TranscriptFreeRect): boolean {
  if (typeof document === "undefined") return false;
  const stage = document.querySelector("main[data-video-stage]");
  if (!stage) return false;

  const sr = stage.getBoundingClientRect();
  if (sr.width <= 0 || sr.height <= 0) return false;

  const overlapW = Math.max(
    0,
    Math.min(rect.x + rect.width, sr.right) - Math.max(rect.x, sr.left),
  );
  const overlapH = Math.max(
    0,
    Math.min(rect.y + rect.height, sr.bottom) - Math.max(rect.y, sr.top),
  );
  if (overlapW <= 0 || overlapH <= 0) return false;

  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const centerInside =
    centerX >= sr.left &&
    centerX <= sr.right &&
    centerY >= sr.top &&
    centerY <= sr.bottom;

  const overlapArea = overlapW * overlapH;
  const panelArea = Math.max(1, rect.width * rect.height);
  return centerInside || overlapArea >= panelArea * 0.25;
}

function findActiveSegmentIndex(
  segments: Segment[],
  currentTime: number,
  isPlaying: boolean,
): number {
  if (segments.length === 0 || (!isPlaying && !(currentTime > 0))) {
    return -1;
  }

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const nextStart =
      i + 1 < segments.length ? segments[i + 1].start : Number.POSITIVE_INFINITY;
    const effectiveEnd = Math.max(seg.end, Math.min(nextStart, seg.end + 0.35));
    if (currentTime >= seg.start - 0.08 && currentTime <= effectiveEnd) {
      return i;
    }
  }
  return -1;
}

function getSlotPositionClasses(params: {
  slot: TranscriptSlot;
  sidebarSide: "left" | "right";
  sidebarVisible: boolean;
  sidebarPinned: boolean;
  dockCollapsed: boolean;
}): {
  isHorizontal: boolean;
  positionClass: string;
  cornerRadiusClass: string;
  dividerBorderClass: string;
} {
  const { slot, sidebarSide, sidebarVisible, sidebarPinned, dockCollapsed } =
    params;

  if (slot === "above-dock") {
    const horizontalLeft =
      sidebarPinned && sidebarSide !== "right"
        ? "left-[calc(var(--sidebar-w)+24px)]"
        : "left-[12px]";
    const horizontalRight =
      sidebarPinned && sidebarSide === "right"
        ? "right-[calc(var(--sidebar-w)+24px)]"
        : "right-[12px]";
    const bottomClass = dockCollapsed
      ? "bottom-[calc(var(--dock-h-collapsed)+12px)]"
      : "bottom-[calc(var(--dock-h)+12px)]";

    return {
      isHorizontal: true,
      positionClass: `${horizontalLeft} ${horizontalRight} ${bottomClass}`,
      cornerRadiusClass: "rounded-t-panel rounded-b-none",
      dividerBorderClass: "border-b border-white/[0.08]",
    };
  }

  const bottomClass = dockCollapsed
    ? "bottom-[calc(var(--dock-h-collapsed)+24px)]"
    : "bottom-[calc(var(--dock-h)+24px)]";

  if (slot === "beside-sidebar") {
    const sideClass =
      sidebarSide === "right"
        ? "right-[calc(var(--sidebar-w)+12px)]"
        : "left-[calc(var(--sidebar-w)+12px)]";
    const cornerRadiusClass = sidebarVisible
      ? sidebarSide === "right"
        ? "rounded-l-panel rounded-r-none"
        : "rounded-r-panel rounded-l-none"
      : "rounded-panel";
    const dividerBorderClass = sidebarVisible
      ? sidebarSide === "right"
        ? "border-r border-white/[0.08]"
        : "border-l border-white/[0.08]"
      : "";
    return {
      isHorizontal: false,
      positionClass: `top-[12px] ${bottomClass} ${sideClass}`,
      cornerRadiusClass,
      dividerBorderClass,
    };
  }

  const oppositeSideClass = sidebarSide === "right" ? "left-0" : "right-0";
  const oppositeCornerRadiusClass =
    sidebarSide === "right"
      ? "rounded-r-panel rounded-l-none"
      : "rounded-l-panel rounded-r-none";
  const oppositeDividerBorderClass =
    sidebarSide === "right" ? "border-l-0" : "border-r-0";
  return {
    isHorizontal: false,
    positionClass: `top-[12px] ${bottomClass} ${oppositeSideClass}`,
    cornerRadiusClass: oppositeCornerRadiusClass,
    dividerBorderClass: oppositeDividerBorderClass,
  };
}

interface SlotPreviewPortalProps {
  visible: boolean;
  hoveredSlot: TranscriptSlot | null;
  sidebarSide: "left" | "right";
  sidebarVisible: boolean;
  sidebarPinned: boolean;
  dockCollapsed: boolean;
}

function SlotPreviewPortal({
  visible,
  hoveredSlot,
  sidebarSide,
  sidebarVisible,
  sidebarPinned,
  dockCollapsed,
}: SlotPreviewPortalProps) {
  if (!visible || typeof document === "undefined") return null;

  const slots: TranscriptSlot[] = [
    "beside-sidebar",
    "opposite-edge",
    "above-dock",
  ];

  return createPortal(
    <>
      {slots.map((slot) => {
        if (slot === "beside-sidebar" && !sidebarVisible) return null;
        const isActive = hoveredSlot === slot;
        const { isHorizontal, positionClass, cornerRadiusClass } =
          getSlotPositionClasses({
            slot,
            sidebarSide,
            sidebarVisible,
            sidebarPinned,
            dockCollapsed,
          });
        return (
          <div
            key={slot}
            aria-hidden="true"
            style={
              isHorizontal
                ? {
                    width: "auto",
                    height: isActive ? "var(--transcript-h)" : "12px",
                  }
                : {
                    width: isActive ? "var(--transcript-w)" : "12px",
                  }
            }
            className={[
              "fixed z-[40] pointer-events-none transition-all duration-[200ms] ease-out",
              isHorizontal ? "" : "max-w-[calc(100vw-var(--sidebar-w)-24px)]",
              positionClass,
              cornerRadiusClass,
              isActive
                ? "border-2 border-dashed border-accent-soft bg-accent/15 opacity-100 scale-100 shadow-[0_0_24px_rgba(91,156,255,0.22)]"
                : "border border-dashed border-white/45 bg-white/[0.08] opacity-100",
            ].join(" ")}
          />
        );
      })}
    </>,
    document.body,
  );
}

interface ResizeHandlesProps {
  visible: boolean;
  showSubtleCornerGlow: boolean;
  hideCornerIndicator?: boolean;
  onStartResize: (edge: ResizeEdge, e: ReactPointerEvent<HTMLDivElement>) => void;
}

function ResizeHandles({
  visible,
  showSubtleCornerGlow,
  hideCornerIndicator = false,
  onStartResize,
}: ResizeHandlesProps) {
  if (!visible) return null;

  return (
    <>
      <div
        data-resize-handle="n"
        onPointerDown={(e) => onStartResize("n", e)}
        className="absolute inset-x-5 top-0 h-3.5 cursor-ns-resize z-20"
      />
      <div
        data-resize-handle="s"
        onPointerDown={(e) => onStartResize("s", e)}
        className="absolute inset-x-5 bottom-0 h-3.5 cursor-ns-resize z-20"
      />
      <div
        data-resize-handle="w"
        onPointerDown={(e) => onStartResize("w", e)}
        className="absolute inset-y-5 left-0 w-3.5 cursor-ew-resize z-20"
      />
      <div
        data-resize-handle="e"
        onPointerDown={(e) => onStartResize("e", e)}
        className="absolute inset-y-5 right-0 w-3.5 cursor-ew-resize z-20"
      />
      <div
        data-resize-handle="nw"
        onPointerDown={(e) => onStartResize("nw", e)}
        className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-30"
      />
      <div
        data-resize-handle="ne"
        onPointerDown={(e) => onStartResize("ne", e)}
        className="absolute top-0 right-0 w-6 h-6 cursor-nesw-resize z-30"
      />
      <div
        data-resize-handle="sw"
        onPointerDown={(e) => onStartResize("sw", e)}
        className="absolute bottom-0 left-0 w-6 h-6 cursor-nesw-resize z-30"
      />
      <div
        data-resize-handle="se"
        onPointerDown={(e) => onStartResize("se", e)}
        className="group/se absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-30 flex items-end justify-end p-1"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          aria-hidden="true"
          className={[
            "transition-opacity duration-fast pointer-events-none text-white/60",
            hideCornerIndicator
              ? "opacity-0"
              : showSubtleCornerGlow
                ? "opacity-55 group-hover/se:opacity-100"
                : "opacity-0 group-hover/panel:opacity-55 group-hover/se:!opacity-100",
          ].join(" ")}
        >
          <path
            d="M7 2.5L2.5 7M7 5.5L5.5 7"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}

export function TranscriptPopover({
  open,
  pinned = false,
  dockCollapsed = false,
  sidebarPinned = false,
  sidebarOpen = false,
  sidebarSide = "left",
  hiddenWithSidebar = false,
  videoKey,
  transcriptionText,
  segments,
  blocks,
  showDiscardedCuts,
  discardedCount,
  currentTime = 0,
  isPlaying = false,
  placementSlot,
  freeRect,
  transparentOverVideo,
  fontSizePx = TRANSCRIPT_FONT_SIZE_DEFAULT,
  blackOverVideoBg = false,
  blackOverVideoOpacity = TRANSCRIPT_BLACK_BG_OPACITY_DEFAULT,
  onTogglePin,
  onToggleShowDiscarded,
  onSeekTo,
  onClose,
  onPlacementChange,
  onTransparentOverVideoChange,
  onAttachedHoverChange,
}: TranscriptPopoverProps) {
  const [tab, setTab] = useState<TranscriptTab>("transcript");
  const [copied, setCopied] = useState(false);
  const [snapshot, setSnapshot] = useState<ContentSnapshot>(() => ({
    videoKey,
    tab: "transcript",
    transcriptionText,
    segments,
    blocks,
  }));
  const [textPhase, setTextPhase] = useState<TextPhase>("idle");

  // Controlled / uncontrolled fallbacks for placement & transparent subtitle mode
  const [internalSlot, setInternalSlot] =
    useState<TranscriptSlot>("beside-sidebar");
  const [internalFreeRect, setInternalFreeRect] =
    useState<TranscriptFreeRect | null>(null);
  const [internalTransparentOverVideo, setInternalTransparentOverVideo] =
    useState(false);

  const rawActiveSlot = placementSlot !== undefined ? placementSlot : internalSlot;
  const activeSlot: TranscriptSlot =
    rawActiveSlot === "beside-sidebar" ||
    rawActiveSlot === "opposite-edge" ||
    rawActiveSlot === "above-dock"
      ? rawActiveSlot
      : "beside-sidebar";
  const activeFreeRect = freeRect !== undefined ? freeRect : internalFreeRect;
  const activeTransparent =
    transparentOverVideo !== undefined
      ? transparentOverVideo
      : internalTransparentOverVideo;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [liveDragRect, setLiveDragRect] = useState<TranscriptFreeRect | null>(
    null,
  );
  const [liveResizeRect, setLiveResizeRect] =
    useState<TranscriptFreeRect | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<TranscriptSlot | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const sidebarVisible = sidebarPinned || sidebarOpen;
  const effectivelyHidden = Boolean(hiddenWithSidebar) && !isDragging;

  const asideRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const latestDataRef = useRef<ContentSnapshot>({
    videoKey,
    tab,
    transcriptionText,
    segments,
    blocks,
  });
  latestDataRef.current = {
    videoKey,
    tab,
    transcriptionText,
    segments,
    blocks,
  };

  const pendingKeyRef = useRef<{
    videoKey: string | undefined;
    tab: TranscriptTab;
  }>({
    videoKey,
    tab,
  });
  const displayedKeyRef = useRef<{
    videoKey: string | undefined;
    tab: TranscriptTab;
  }>({
    videoKey,
    tab,
  });

  const outTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const inTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const manualScrollUntilRef = useRef<number>(0);
  const lastScrolledKeyRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const manualRestoreHoldRef = useRef(false);

  const updatePlacement = (next: {
    slot: TranscriptSlot;
    freeRect: TranscriptFreeRect | null;
  }) => {
    if (placementSlot === undefined) {
      setInternalSlot(next.slot);
    }
    if (freeRect === undefined) {
      setInternalFreeRect(next.freeRect);
    }
    onPlacementChange?.(next);
  };

  const updateTransparent = (next: boolean) => {
    if (transparentOverVideo === undefined) {
      setInternalTransparentOverVideo(next);
    }
    onTransparentOverVideoChange?.(next);
  };

  // Refs synced for window event callbacks
  const callbacksRef = useRef({
    sidebarSide,
    sidebarVisible,
    sidebarPinned,
    activeSlot,
    updatePlacement,
    updateTransparent,
  });
  callbacksRef.current = {
    sidebarSide,
    sidebarVisible,
    sidebarPinned,
    activeSlot,
    updatePlacement,
    updateTransparent,
  };

  const clearTransitionTimers = () => {
    if (outTimerRef.current !== null) {
      window.clearTimeout(outTimerRef.current);
      outTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (inTimerRef.current !== null) {
      window.clearTimeout(inTimerRef.current);
      inTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearTransitionTimers();
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      document.body.style.cursor = "";
    };
  }, []);

  // Reset hover/drag state when closed
  useEffect(() => {
    if (!open) {
      setIsHovered(false);
      setIsDragging(false);
      setIsResizing(false);
      setLiveDragRect(null);
      setLiveResizeRect(null);
      setHoveredSlot(null);
      manualRestoreHoldRef.current = false;
      document.body.style.cursor = "";
    }
  }, [open]);

  // Pause hover & prevent focus retention while hidden alongside the sidebar
  useEffect(() => {
    const el = asideRef.current as (HTMLElement & { inert: boolean }) | null;
    if (el) {
      el.inert = effectivelyHidden;
    }
    if (effectivelyHidden) {
      setIsHovered(false);
      if (
        el &&
        document.activeElement instanceof HTMLElement &&
        el.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
    }
  }, [effectivelyHidden, open]);

  // Notify parent when hovering or dragging the panel while attached beside the sidebar
  const onAttachedHoverChangeRef = useRef(onAttachedHoverChange);
  onAttachedHoverChangeRef.current = onAttachedHoverChange;

  const attachedHoverActive =
    open &&
    !effectivelyHidden &&
    activeSlot === "beside-sidebar" &&
    activeFreeRect === null &&
    (isHovered || isDragging);

  useEffect(() => {
    onAttachedHoverChangeRef.current?.(attachedHoverActive);
  }, [attachedHoverActive]);

  useEffect(() => {
    return () => {
      onAttachedHoverChangeRef.current?.(false);
    };
  }, []);

  // Smooth content swap when videoKey or tab changes
  useEffect(() => {
    if (!open) {
      clearTransitionTimers();
      pendingKeyRef.current = { videoKey, tab };
      displayedKeyRef.current = { videoKey, tab };
      setSnapshot({ videoKey, tab, transcriptionText, segments, blocks });
      setTextPhase("idle");
      lastScrolledKeyRef.current = null;
      return;
    }

    const keyChanged =
      pendingKeyRef.current.videoKey !== videoKey ||
      pendingKeyRef.current.tab !== tab;

    if (keyChanged) {
      pendingKeyRef.current = { videoKey, tab };
      lastScrolledKeyRef.current = null;
      if (pendingKeyRef.current.videoKey !== displayedKeyRef.current.videoKey) {
        manualScrollUntilRef.current = 0;
      }
      clearTransitionTimers();

      if (prefersReducedMotion()) {
        displayedKeyRef.current = { videoKey, tab };
        setSnapshot({ videoKey, tab, transcriptionText, segments, blocks });
        if (contentRef.current) {
          contentRef.current.scrollTop = 0;
        }
        setTextPhase("idle");
        return;
      }

      setTextPhase("out");
      outTimerRef.current = window.setTimeout(() => {
        outTimerRef.current = null;
        const next = latestDataRef.current;
        displayedKeyRef.current = { videoKey: next.videoKey, tab: next.tab };
        setSnapshot(next);
        if (contentRef.current) {
          contentRef.current.scrollTop = 0;
        }
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (contentRef.current) {
            contentRef.current.scrollTop = 0;
          }
          setTextPhase("in");
          inTimerRef.current = window.setTimeout(() => {
            inTimerRef.current = null;
            setTextPhase("idle");
          }, 200);
        });
      }, 150);
      return;
    }

    if (
      displayedKeyRef.current.videoKey === videoKey &&
      displayedKeyRef.current.tab === tab
    ) {
      setSnapshot({ videoKey, tab, transcriptionText, segments, blocks });
    }
  }, [open, videoKey, tab, transcriptionText, segments, blocks]);

  // Timer: 1.5s positioned over the video stage (outside lateral slots) -> transparent subtitle mode
  const evaluatedOverVideo = useMemo(() => {
    if (!open || effectivelyHidden || pinned || activeTransparent || isResizing) return false;
    if (manualRestoreHoldRef.current) return false;
    if (isDragging) {
      if (hoveredSlot !== null || !liveDragRect) return false;
      return isRectOverVideoStage(liveDragRect);
    }
    if (!activeFreeRect) return false;
    return isRectOverVideoStage(activeFreeRect);
  }, [
    open,
    effectivelyHidden,
    pinned,
    activeTransparent,
    isResizing,
    isDragging,
    hoveredSlot,
    liveDragRect,
    activeFreeRect,
  ]);

  useEffect(() => {
    if (!evaluatedOverVideo) return;

    const timerId = window.setTimeout(() => {
      callbacksRef.current.updateTransparent(true);
    }, TRANSPARENT_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [evaluatedOverVideo]);

  // Karaoke active segment index
  const activeSegmentIdx = useMemo(
    () => findActiveSegmentIndex(snapshot.segments, currentTime, isPlaying),
    [snapshot.segments, currentTime, isPlaying],
  );

  const displayFreeRect = liveDragRect ?? liveResizeRect ?? activeFreeRect;
  const isFreePositioned = !pinned && displayFreeRect !== null;
  const slotStyling = getSlotPositionClasses({
    slot: activeSlot,
    sidebarSide,
    sidebarVisible,
    sidebarPinned,
    dockCollapsed,
  });
  const isCenteredHorizontal = isFreePositioned
    ? displayFreeRect !== null && displayFreeRect.width > displayFreeRect.height
    : slotStyling.isHorizontal;

  const [contentHeight, setContentHeight] = useState(0);
  const [edgeFades, setEdgeFades] = useState<{ top: number; bottom: number }>({
    top: 0,
    bottom: 0,
  });

  useEffect(() => {
    if (!open) {
      setContentHeight(0);
      return;
    }
    const el = contentRef.current;
    if (!el) return;

    const updateHeight = () => {
      setContentHeight(el.clientHeight);
    };
    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  const fadePx = useMemo(() => {
    if (contentHeight <= 0 || isDragging) return 0;
    if (!isFreePositioned && !slotStyling.isHorizontal) {
      return Math.min(60, Math.floor(contentHeight * 0.24));
    }
    if (!isFreePositioned && slotStyling.isHorizontal) {
      return Math.min(24, Math.floor(contentHeight * 0.22));
    }
    const targetFade =
      contentHeight < 170 ? 22 : contentHeight < 260 ? 36 : 54;
    return Math.min(targetFade, Math.floor(contentHeight * 0.22));
  }, [contentHeight, isDragging, isFreePositioned, slotStyling.isHorizontal]);

  const fadeEvalStateRef = useRef({
    fadePx: 0,
    activeSegmentIdx: -1,
    segments: snapshot.segments,
    tab: snapshot.tab,
    open,
    effectivelyHidden,
    isDragging,
  });
  fadeEvalStateRef.current = {
    fadePx,
    activeSegmentIdx,
    segments: snapshot.segments,
    tab: snapshot.tab,
    open,
    effectivelyHidden,
    isDragging,
  };

  const evaluateEdgeFade = useCallback(() => {
    const {
      fadePx: currentFadePx,
      activeSegmentIdx: currentActiveIdx,
      segments: currentSegments,
      tab: currentTab,
      open: isOpen,
      effectivelyHidden: isHidden,
      isDragging: dragging,
    } = fadeEvalStateRef.current;

    const container = contentRef.current;
    if (!isOpen || isHidden || dragging || currentFadePx <= 0 || !container) {
      setEdgeFades((prev) =>
        prev.top === 0 && prev.bottom === 0 ? prev : { top: 0, bottom: 0 },
      );
      return;
    }

    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const atTop = scrollTop <= 4;
    const atBottom = maxScrollTop - scrollTop <= 4;

    let nextTop = currentFadePx;
    let nextBottom = currentFadePx;

    if (currentTab !== "transcript" || currentActiveIdx < 0) {
      if (atTop) nextTop = 0;
      if (atBottom) nextBottom = 0;
    } else {
      const activeSeg = currentSegments[currentActiveIdx];
      const activeEl = activeSeg
        ? segmentRefs.current.get(activeSeg.segment_id)
        : undefined;

      if (activeEl) {
        const containerRect = container.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        const relTop = elRect.top - containerRect.top;
        const relBottom = containerRect.bottom - elRect.bottom;

        const activeNearTop =
          (currentActiveIdx === 0 && atTop) ||
          (elRect.bottom > containerRect.top && relTop < currentFadePx + 8);
        const activeNearBottom =
          (currentActiveIdx === currentSegments.length - 1 && atBottom) ||
          (elRect.top < containerRect.bottom && relBottom < currentFadePx + 8);

        if (atTop || activeNearTop) nextTop = 0;
        if (atBottom || activeNearBottom) nextBottom = 0;
      } else {
        if (atTop) nextTop = 0;
        if (atBottom) nextBottom = 0;
      }
    }

    setEdgeFades((prev) =>
      prev.top === nextTop && prev.bottom === nextBottom
        ? prev
        : { top: nextTop, bottom: nextBottom },
    );
  }, []);

  useEffect(() => {
    evaluateEdgeFade();
  }, [
    evaluateEdgeFade,
    open,
    effectivelyHidden,
    isDragging,
    fadePx,
    contentHeight,
    activeSegmentIdx,
    snapshot.tab,
    snapshot.segments,
    textPhase,
  ]);

  // Smooth auto-scroll keeping the active spoken segment centered
  useEffect(() => {
    if (
      !open ||
      effectivelyHidden ||
      snapshot.tab !== "transcript" ||
      textPhase !== "idle" ||
      activeSegmentIdx < 0
    ) {
      return;
    }

    const seg = snapshot.segments[activeSegmentIdx];
    if (!seg) return;

    const scrollKey = `${snapshot.videoKey ?? ""}:${activeSegmentIdx}:${seg.segment_id}`;
    if (lastScrolledKeyRef.current === scrollKey) return;
    lastScrolledKeyRef.current = scrollKey;

    if (Date.now() < manualScrollUntilRef.current) return;

    const container = contentRef.current;
    const el = segmentRefs.current.get(seg.segment_id);
    if (!container || !el) return;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offsetWithinContainer =
      elRect.top - containerRect.top + container.scrollTop;
    const targetTop = Math.max(
      0,
      offsetWithinContainer - container.clientHeight / 2 + el.clientHeight / 2,
    );

    container.scrollTo({
      top: targetTop,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [
    open,
    effectivelyHidden,
    snapshot.tab,
    snapshot.videoKey,
    snapshot.segments,
    activeSegmentIdx,
    textPhase,
  ]);

  const handlePanelPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (pinned || effectivelyHidden || e.button !== 0 || isResizing) return;

    const target = e.target as Element | null;
    if (!target) return;

    if (
      target.closest(
        "button, a, input, textarea, select, [data-resize-handle], [data-selectable-text]",
      )
    ) {
      return;
    }

    const asideEl = asideRef.current;
    if (!asideEl) return;

    const rect = asideEl.getBoundingClientRect();
    const originRect: TranscriptFreeRect = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const wasFreePositioned = activeFreeRect !== null;
    const savedExpandedWidth = originRect.width;
    const savedExpandedHeight = originRect.height;

    const headerRect = headerRef.current?.getBoundingClientRect();
    const measuredHeaderH =
      headerRect && headerRect.height >= 20 ? headerRect.height : 48;
    const dragH = Math.max(46, Math.ceil(measuredHeaderH) + 2);
    const dragW = Math.min(originRect.width, 340);

    const startX = e.clientX;
    const startY = e.clientY;
    const dragOriginX =
      originRect.width > dragW
        ? clamp(
            startX - dragW / 2,
            originRect.x,
            originRect.x + originRect.width - dragW,
          )
        : originRect.x;
    const dragOriginY =
      startY - originRect.y > dragH - 8
        ? startY - Math.round(dragH / 2)
        : originRect.y;

    const pointerId = e.pointerId;
    let dragStarted = false;
    let collapseArmed = false;
    let dragAnimRaf: number | null = null;
    let latestDx = 0;
    let latestDy = 0;
    let latestRect: TranscriptFreeRect = originRect;
    let latestSlot: TranscriptSlot | null = null;

    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (dragAnimRaf !== null) {
        window.cancelAnimationFrame(dragAnimRaf);
        dragAnimRaf = null;
      }
      document.body.style.cursor = "";
    };

    const computeCollapsedDragRect = (dx: number, dy: number) =>
      clampRectToViewport(
        {
          x: dragOriginX + dx,
          y: dragOriginY + dy,
          width: dragW,
          height: dragH,
        },
        {
          minWidth: Math.min(dragW, MIN_FREE_WIDTH),
          minHeight: dragH,
        },
      );

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      latestDx = dx;
      latestDy = dy;

      if (!dragStarted) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
        dragStarted = true;
        suppressClickRef.current = true;
        manualRestoreHoldRef.current = false;
        window.getSelection()?.removeAllRanges();
        document.body.style.cursor = "grabbing";
        setIsDragging(true);
        // Frame 0: lock concrete pixel bounds; pre-shrink wide horizontal slots to dragW to prevent right overflow while height collapses smoothly
        const initialDragRect: TranscriptFreeRect =
          originRect.width > dragW
            ? clampRectToViewport(
                {
                  x: dragOriginX,
                  y: originRect.y,
                  width: dragW,
                  height: originRect.height,
                },
                {
                  minWidth: Math.min(dragW, MIN_FREE_WIDTH),
                  minHeight: Math.min(originRect.height, MIN_FREE_HEIGHT),
                },
              )
            : originRect;
        setLiveDragRect(initialDragRect);
        dragAnimRaf = window.requestAnimationFrame(() => {
          dragAnimRaf = null;
          collapseArmed = true;
          const nextRect = computeCollapsedDragRect(latestDx, latestDy);
          latestRect = nextRect;
          setLiveDragRect(nextRect);
        });
      } else if (collapseArmed) {
        latestRect = computeCollapsedDragRect(dx, dy);
        setLiveDragRect(latestRect);
      }

      latestSlot = detectDropSlot({
        clientX: moveEvent.clientX,
        clientY: moveEvent.clientY,
        sidebarSide: callbacksRef.current.sidebarSide,
        sidebarVisible: callbacksRef.current.sidebarVisible,
      });

      setHoveredSlot(latestSlot);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();

      if (!dragStarted) return;

      if (!collapseArmed) {
        latestRect = computeCollapsedDragRect(latestDx, latestDy);
      }

      setIsDragging(false);
      setLiveDragRect(null);
      setHoveredSlot(null);

      if (latestSlot !== null) {
        manualRestoreHoldRef.current = false;
        callbacksRef.current.updateTransparent(false);
        callbacksRef.current.updatePlacement({
          slot: latestSlot,
          freeRect: null,
        });
      } else {
        const dropWidth = wasFreePositioned
          ? Math.max(MIN_FREE_WIDTH, savedExpandedWidth)
          : Math.max(MIN_FREE_WIDTH, Math.min(savedExpandedWidth, 380));
        const dropHeight = wasFreePositioned
          ? Math.max(MIN_FREE_HEIGHT, savedExpandedHeight)
          : Math.max(MIN_FREE_HEIGHT, Math.min(savedExpandedHeight, 400));
        const centerX = latestRect.x + latestRect.width / 2;
        const centerY = latestRect.y + latestRect.height / 2;
        const finalFreeRect = clampRectToViewport({
          x: centerX - dropWidth / 2,
          y: centerY - dropHeight / 2,
          width: dropWidth,
          height: dropHeight,
        });
        callbacksRef.current.updatePlacement({
          slot: callbacksRef.current.activeSlot,
          freeRect: finalFreeRect,
        });
      }

      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleStartResize = (
    edge: ResizeEdge,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (pinned || effectivelyHidden || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const asideEl = asideRef.current;
    if (!asideEl) return;

    const rect = asideEl.getBoundingClientRect();
    const originRect: TranscriptFreeRect = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let latestRect = originRect;

    suppressClickRef.current = true;
    setIsResizing(true);
    setLiveResizeRect(originRect);
    document.body.style.cursor = RESIZE_CURSORS[edge];

    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.style.cursor = "";
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      latestRect = computeResizedRect(originRect, edge, dx, dy);
      setLiveResizeRect(latestRect);
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      setIsResizing(false);
      setLiveResizeRect(null);
      callbacksRef.current.updatePlacement({
        slot: callbacksRef.current.activeSlot,
        freeRect: latestRect,
      });
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleAsideClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (activeTransparent && !isDragging && !isResizing) {
      const target = e.target as Element | null;
      if (target?.closest("[data-resize-handle]")) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      manualRestoreHoldRef.current = true;
      updateTransparent(false);
    }
  };

  const handleAsideClick = () => {
    if (activeTransparent && !isDragging && !isResizing) {
      manualRestoreHoldRef.current = true;
      updateTransparent(false);
    }
  };

  if (!open) return null;

  const plainText =
    segments.length > 0
      ? segments.map((s) => `[${formatShortTime(s.start)}] ${s.text}`).join("\n")
      : transcriptionText;

  const canExport =
    tab === "transcript" ? Boolean(plainText) : blocks.length > 0;

  const handleCopy = async () => {
    const textToCopy =
      tab === "transcript" ? plainText : JSON.stringify(blocks, null, 2);
    if (!textToCopy || !canExport) return;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1800);
  };

  const handleDownload = () => {
    const content =
      tab === "transcript" ? plainText : JSON.stringify(blocks, null, 2);
    if (!content || !canExport) return;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tab === "transcript" ? "transcricao.txt" : "blocos.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const isTransparentSurface = activeTransparent || isDragging;
  const showMarkings = isDragging;
  const showHeader = !activeTransparent || isDragging;
  const disableFocus = isTransparentSurface || effectivelyHidden;

  const textTransitionClass =
    textPhase === "out"
      ? "opacity-0 translate-y-1 transition-[opacity,transform] duration-[150ms] ease-out"
      : "opacity-100 translate-y-0 transition-[opacity,transform] duration-[200ms] ease-out";

  const discardedLabel = showDiscardedCuts
    ? `Ocultar descartados (${discardedCount})`
    : `Mostrar descartados (${discardedCount})`;

  const surfaceClass = isTransparentSurface
    ? showMarkings
      ? "bg-transparent border border-white shadow-none"
      : "bg-transparent border border-transparent shadow-none"
    : "glass";

  const resolvedFontSize = clamp(
    Math.round(fontSizePx ?? TRANSCRIPT_FONT_SIZE_DEFAULT),
    TRANSCRIPT_FONT_SIZE_MIN,
    TRANSCRIPT_FONT_SIZE_MAX,
  );

  const resolvedBlackAlpha =
    clamp(
      Math.round(blackOverVideoOpacity ?? TRANSCRIPT_BLACK_BG_OPACITY_DEFAULT),
      TRANSCRIPT_BLACK_BG_OPACITY_MIN,
      TRANSCRIPT_BLACK_BG_OPACITY_MAX,
    ) / 100;

  const headerClass = isTransparentSurface
    ? showHeader
      ? "flex items-center justify-between gap-1.5 flex-wrap px-2.5 py-2.5 border-b border-white opacity-100 overflow-hidden shrink-0 transition-[opacity,border-color] duration-base ease-out"
      : "flex items-center justify-between gap-1.5 flex-wrap px-2.5 py-2.5 border-b border-transparent opacity-0 overflow-hidden shrink-0 transition-[opacity,border-color] duration-base ease-out"
    : "flex items-center justify-between gap-1.5 flex-wrap px-2.5 py-2.5 border-b border-line shrink-0";

  const ghostTabClass = (_active: boolean) =>
    "h-7 px-2.5 rounded-pill text-xs font-medium whitespace-nowrap opacity-100 border border-white bg-transparent text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] pointer-events-none";

  const ghostIconButtonClass =
    "grid h-7 w-7 place-items-center rounded-pill opacity-100 border border-white bg-transparent text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)] pointer-events-none";

  const asideInlineStyle: React.CSSProperties = {
    ...(isFreePositioned && displayFreeRect
      ? {
          left: displayFreeRect.x,
          top: displayFreeRect.y,
          width: displayFreeRect.width,
          height: displayFreeRect.height,
        }
      : slotStyling.isHorizontal
        ? {
            width: "auto",
            height: "var(--transcript-h)",
          }
        : {
            width: "var(--transcript-w)",
          }),
    ...(isTransparentSurface
      ? {
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          boxShadow: "none",
        }
      : {}),
    ...(isDragging || isResizing
      ? {
          WebkitUserSelect: "none",
          userSelect: "none",
        }
      : {}),
  };

  const hasActiveHighlight = activeSegmentIdx >= 0;
  const topFadePx = isDragging ? 0 : edgeFades.top;
  const bottomFadePx = isDragging ? 0 : edgeFades.bottom;
  const contentMaskGradient =
    topFadePx > 0 || bottomFadePx > 0
      ? `linear-gradient(to bottom, ${
          topFadePx > 0 ? `transparent 0px, black ${topFadePx}px` : "black 0px"
        }, ${
          bottomFadePx > 0
            ? `black calc(100% - ${bottomFadePx}px), transparent 100%`
            : "black 100%"
        })`
      : undefined;
  const contentScrollStyle: React.CSSProperties | undefined = contentMaskGradient
    ? {
        maskImage: contentMaskGradient,
        WebkitMaskImage: contentMaskGradient,
      }
    : undefined;
  const innerEdgePad = Math.max(14, fadePx);

  return (
    <>
      <SlotPreviewPortal
        visible={isDragging}
        hoveredSlot={hoveredSlot}
        sidebarSide={sidebarSide}
        sidebarVisible={sidebarVisible}
        sidebarPinned={sidebarPinned}
        dockCollapsed={dockCollapsed}
      />

      <aside
        ref={asideRef}
        role="complementary"
        aria-label="Transcrição"
        aria-hidden={effectivelyHidden || undefined}
        style={asideInlineStyle}
        onMouseEnter={() => {
          if (!effectivelyHidden) setIsHovered(true);
        }}
        onMouseLeave={() => setIsHovered(false)}
        onPointerDown={handlePanelPointerDown}
        onClickCapture={handleAsideClickCapture}
        onClick={handleAsideClick}
        className={[
          "group/panel fixed flex flex-col overflow-hidden",
          isFreePositioned || isDragging || isResizing
            ? "z-popover"
            : slotStyling.isHorizontal
              ? "z-[25]"
              : "z-sidebar",
          isFreePositioned
            ? "rounded-panel"
            : [
                slotStyling.isHorizontal
                  ? ""
                  : "max-w-[calc(100vw-var(--sidebar-w)-24px)]",
                slotStyling.positionClass,
                slotStyling.cornerRadiusClass,
                slotStyling.dividerBorderClass,
              ].join(" "),
          surfaceClass,
          isDragging
            ? "cursor-grabbing select-none transition-[width,height,background-color,border-color,box-shadow,border-radius] duration-base ease-out"
            : isResizing
              ? "select-none transition-none"
              : "transition-[left,right,top,bottom,width,height,background-color,border-color,box-shadow,opacity,transform,border-radius] duration-slow ease-out",
          effectivelyHidden
            ? sidebarSide === "right"
              ? "opacity-0 translate-x-3 pointer-events-none"
              : "opacity-0 -translate-x-3 pointer-events-none"
            : "opacity-100 translate-x-0 pointer-events-auto",
          activeTransparent && isHovered && !isDragging ? "cursor-pointer" : "",
        ].join(" ")}
      >
        <ResizeHandles
          visible={
            isFreePositioned && !pinned && !isDragging && !effectivelyHidden
          }
          showSubtleCornerGlow={false}
          hideCornerIndicator={activeTransparent && !isDragging}
          onStartResize={handleStartResize}
        />

        {/* Cabeçalho compacto com abas e ações */}
        <div
          ref={headerRef}
          className={[
            headerClass,
            !pinned && !isDragging ? "cursor-grab" : "",
          ].join(" ")}
        >
          <div
            className={[
              "flex items-center gap-1 min-w-0",
              activeTransparent && !isDragging ? "pointer-events-none" : "",
            ].join(" ")}
          >
            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={() => setTab("transcript")}
              className={
                isTransparentSurface
                  ? ghostTabClass(tab === "transcript")
                  : [
                      "h-7 px-2.5 rounded-pill text-xs font-medium whitespace-nowrap transition-colors duration-fast",
                      tab === "transcript"
                        ? "bg-glass-active text-text-1"
                        : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                    ].join(" ")
              }
            >
              Transcrição
            </button>
            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={() => setTab("blocks")}
              className={
                isTransparentSurface
                  ? ghostTabClass(tab === "blocks")
                  : [
                      "h-7 px-2.5 rounded-pill text-xs font-medium whitespace-nowrap transition-colors duration-fast",
                      tab === "blocks"
                        ? "bg-glass-active text-text-1"
                        : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                    ].join(" ")
              }
            >
              Blocos
            </button>
          </div>

          <div
            className={[
              "flex items-center gap-0.5 shrink-0",
              activeTransparent && !isDragging ? "pointer-events-none" : "",
            ].join(" ")}
          >
            {discardedCount > 0 && (
              <button
                type="button"
                tabIndex={disableFocus ? -1 : undefined}
                onClick={onToggleShowDiscarded}
                title={discardedLabel}
                aria-label={discardedLabel}
                aria-pressed={showDiscardedCuts}
                className={
                  isTransparentSurface
                    ? ghostIconButtonClass
                    : [
                        "grid h-7 w-7 place-items-center rounded-pill transition-colors duration-fast",
                        showDiscardedCuts
                          ? "bg-glass-active text-text-1"
                          : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                      ].join(" ")
                }
              >
                {showDiscardedCuts ? <EyeSlash size={15} /> : <Eye size={15} />}
              </button>
            )}

            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={() => void handleCopy()}
              disabled={!canExport}
              title={
                copied
                  ? "Copiado"
                  : tab === "transcript"
                    ? "Copiar transcrição"
                    : "Copiar blocos"
              }
              aria-label={
                copied
                  ? "Copiado"
                  : tab === "transcript"
                    ? "Copiar transcrição"
                    : "Copiar blocos"
              }
              className={
                isTransparentSurface
                  ? ghostIconButtonClass
                  : "grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:text-text-1 hover:bg-glass-hover disabled:opacity-40 transition-colors duration-fast"
              }
            >
              {copied ? (
                <Check size={15} className="text-success" />
              ) : (
                <Copy size={15} />
              )}
            </button>

            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={handleDownload}
              disabled={!canExport}
              title={
                tab === "transcript"
                  ? "Baixar transcrição (.txt)"
                  : "Baixar blocos (.json)"
              }
              aria-label={
                tab === "transcript" ? "Baixar transcrição" : "Baixar blocos"
              }
              className={
                isTransparentSurface
                  ? ghostIconButtonClass
                  : "grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:text-text-1 hover:bg-glass-hover disabled:opacity-40 transition-colors duration-fast"
              }
            >
              <DownloadSimple size={15} />
            </button>

            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={(e) => {
                e.currentTarget.blur();
                onTogglePin?.();
              }}
              aria-label={
                pinned ? "Desafixar transcrição" : "Fixar transcrição"
              }
              title={pinned ? "Desafixar transcrição" : "Fixar transcrição"}
              aria-pressed={pinned}
              className={
                isTransparentSurface
                  ? ghostIconButtonClass
                  : [
                      "grid h-7 w-7 place-items-center rounded-pill transition-colors duration-fast",
                      pinned
                        ? "bg-accent/15 text-accent-soft"
                        : "text-text-2 hover:bg-glass-hover hover:text-text-1",
                    ].join(" ")
              }
            >
              <PushPin size={16} weight={pinned ? "fill" : "regular"} />
            </button>

            <button
              type="button"
              tabIndex={disableFocus ? -1 : undefined}
              onClick={onClose}
              title="Fechar transcrição"
              aria-label="Fechar transcrição"
              className={
                isTransparentSurface
                  ? ghostIconButtonClass
                  : "grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
              }
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Conteúdo com transição suave ao trocar vídeo/aba + sync estilo Apple Music */}
        <div
          ref={contentRef}
          style={contentScrollStyle}
          onScroll={evaluateEdgeFade}
          onWheel={() => {
            manualScrollUntilRef.current = Date.now() + MANUAL_SCROLL_PAUSE_MS;
          }}
          onTouchStart={() => {
            manualScrollUntilRef.current = Date.now() + MANUAL_SCROLL_PAUSE_MS;
          }}
          className={[
            "flex-1 w-full min-w-0 overflow-x-hidden transition-[max-height,opacity,padding] duration-base ease-out",
            activeTransparent && !isDragging ? "no-scrollbar" : "arc-scroll",
            isDragging
              ? "max-h-0 opacity-0 py-0 px-3.5 overflow-hidden"
              : "max-h-[100vh] opacity-100 overflow-y-auto px-3.5 py-0",
            !activeTransparent && !pinned && !isDragging ? "cursor-grab" : "",
            isTransparentSurface
              ? "drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]"
              : "",
          ].join(" ")}
        >
          <div
            style={{
              ...(isDragging
                ? {}
                : { paddingTop: innerEdgePad, paddingBottom: innerEdgePad }),
              fontSize: `${resolvedFontSize}px`,
            }}
            className={[
              "w-full min-w-0 space-y-2",
              textTransitionClass,
            ].join(" ")}
          >
            {snapshot.tab === "transcript" ? (
              snapshot.segments.length > 0 ? (
                snapshot.segments.map((seg, idx) => {
                  const isActive = idx === activeSegmentIdx;
                  const scaleOriginClass = isCenteredHorizontal
                    ? "origin-center"
                    : "origin-left";
                  const rowToneClass = isActive
                    ? activeTransparent
                      ? `opacity-100 scale-[1.01] ${scaleOriginClass}`
                      : `opacity-100 scale-[1.01] ${scaleOriginClass} bg-white/[0.08]`
                    : hasActiveHighlight
                      ? activeTransparent
                        ? "opacity-40 hover:opacity-85"
                        : "opacity-35 hover:opacity-85"
                      : "opacity-100";

                  const textToneClass = isActive
                    ? "text-white font-semibold"
                    : hasActiveHighlight
                      ? activeTransparent
                        ? "text-white/75"
                        : "text-text-2"
                      : activeTransparent
                        ? "text-white"
                        : "text-text-1";

                  const timeToneClass = isActive
                    ? "text-accent-soft font-medium"
                    : activeTransparent
                      ? "text-white/60"
                      : "text-text-3";

                  return (
                    <button
                      key={seg.segment_id}
                      ref={(node) => {
                        if (node) {
                          segmentRefs.current.set(seg.segment_id, node);
                        } else {
                          segmentRefs.current.delete(seg.segment_id);
                        }
                      }}
                      type="button"
                      tabIndex={effectivelyHidden ? -1 : undefined}
                      onClick={() => onSeekTo(seg.start)}
                      className={[
                        "relative w-full min-w-0 flex items-start gap-2.5 px-2.5 py-1.5 rounded-item transition-[opacity,transform,color,background-color] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                        isCenteredHorizontal
                          ? "max-w-[78ch] mx-auto justify-center text-center"
                          : "text-left",
                        activeTransparent
                          ? "hover:bg-white/[0.08]"
                          : "hover:bg-glass-hover",
                        rowToneClass,
                      ].join(" ")}
                    >
                      <span className="relative inline-flex max-w-full items-start gap-2.5">
                        {blackOverVideoBg && activeTransparent && !isDragging && isActive && (
                          <span
                            aria-hidden="true"
                            style={{
                              background: `radial-gradient(ellipse 92% 88% at 50% 50%, rgba(0, 0, 0, ${resolvedBlackAlpha}) 45%, rgba(0, 0, 0, ${(resolvedBlackAlpha * 0.45).toFixed(3)}) 75%, transparent 100%)`,
                            }}
                            className="pointer-events-none absolute -inset-x-2 -inset-y-1 z-0 rounded-[14px] blur-[5px] transition-opacity duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                          />
                        )}
                        <span
                          style={{
                            fontSize: `${Math.max(11, Math.round(resolvedFontSize * 0.76))}px`,
                          }}
                          className={[
                            "relative z-10 tabular-nums pt-0.5 shrink-0 transition-colors duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                            timeToneClass,
                          ].join(" ")}
                        >
                          {formatShortTime(seg.start)}
                        </span>
                        <span
                          className={[
                            "relative z-10 min-w-0 break-words leading-relaxed transition-colors duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                            textToneClass,
                          ].join(" ")}
                        >
                          {seg.text}
                        </span>
                      </span>
                    </button>
                  );
                })
              ) : snapshot.transcriptionText ? (
                <p
                  data-selectable-text="true"
                  className={[
                    "w-full break-words whitespace-pre-wrap leading-relaxed cursor-text",
                    isCenteredHorizontal ? "text-center max-w-[78ch] mx-auto" : "",
                    activeTransparent ? "text-white" : "text-text-1",
                  ].join(" ")}
                >
                  {snapshot.transcriptionText}
                </p>
              ) : (
                <p
                  className={[
                    "text-sm py-6 text-center",
                    activeTransparent ? "text-white/75" : "text-text-3",
                  ].join(" ")}
                >
                  Nenhuma transcrição disponível para este vídeo ainda.
                </p>
              )
            ) : snapshot.blocks.length > 0 ? (
              snapshot.blocks.map((block, index) => {
                const start = Number(block.start ?? 0);
                const text = String(block.text ?? block.summary ?? "");
                return (
                  <button
                    key={String(block.block_id ?? index)}
                    type="button"
                    tabIndex={effectivelyHidden ? -1 : undefined}
                    onClick={() => onSeekTo(start)}
                    className={[
                      "w-full min-w-0 flex flex-col gap-1 px-3 py-2 rounded-item transition-colors duration-fast",
                      isCenteredHorizontal
                        ? "items-center text-center max-w-[78ch] mx-auto"
                        : "text-left",
                      activeTransparent
                        ? "bg-white/[0.04] hover:bg-white/[0.10]"
                        : "bg-white/[0.03] hover:bg-glass-hover",
                    ].join(" ")}
                  >
                    <span
                      style={{
                        fontSize: `${Math.max(11, Math.round(resolvedFontSize * 0.76))}px`,
                      }}
                      className="text-accent-soft tabular-nums"
                    >
                      {formatShortTime(start)}
                    </span>
                    <span
                      style={{
                        fontSize: `${Math.max(13, resolvedFontSize - 1)}px`,
                      }}
                      className={[
                        "w-full break-words leading-relaxed",
                        activeTransparent ? "text-white" : "text-text-1",
                      ].join(" ")}
                    >
                      {text}
                    </span>
                  </button>
                );
              })
            ) : (
              <p
                className={[
                  "text-sm py-6 text-center",
                  activeTransparent ? "text-white/75" : "text-text-3",
                ].join(" ")}
              >
                Nenhum bloco semântico gerado ainda.
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
