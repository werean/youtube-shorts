import { ArrowCounterClockwise, Check, X } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* -------------------------------------------------------------------------- */
/* Navegação / metadados das seções                                            */
/* -------------------------------------------------------------------------- */

export type SectionId =
  | "app-folders"
  | "app-download"
  | "dependencies"
  | "ai-model"
  | "ai-search"
  | "ai-instructions"
  | "whisper-model"
  | "whisper-language"
  | "whisper-advanced"
  | "transcript-display"
  | "ffmpeg-quality"
  | "ffmpeg-visual"
  | "ffmpeg-audio"
  | "ffmpeg-advanced"
  | "watermark"
  | "batch"
  | "how-to-use";

export type NavIconName = "gear" | "cpu" | "sparkle" | "microphone" | "film" | "stamp";

export interface NavChild {
  id: SectionId;
  label: string;
}

export interface NavGroup {
  /** Identificador do grupo (ex.: "aplicacao"). */
  id: string;
  label: string;
  /** Nome lógico do ícone Phosphor — o consumidor mapeia para o componente. */
  icon: NavIconName;
  /** Grupo com filhos (expansível). */
  children?: NavChild[];
  /** Grupo folha (sem filhos): seção aberta diretamente. */
  leafId?: SectionId;
}

export const SETTINGS_NAV_GROUPS: NavGroup[] = [
  {
    id: "aplicacao",
    label: "Aplicação",
    icon: "gear",
    children: [
      { id: "app-folders", label: "Pastas" },
      { id: "app-download", label: "Download" },
    ],
  },
  {
    id: "marca-dagua",
    label: "Marca d'água",
    icon: "stamp",
    leafId: "watermark",
  },
  {
    id: "dependencias",
    label: "Dependências",
    icon: "cpu",
    leafId: "dependencies",
  },
  {
    id: "ia",
    label: "IA e Modelos",
    icon: "sparkle",
    children: [
      { id: "ai-model", label: "Modelo" },
      { id: "ai-search", label: "Busca por trechos" },
      { id: "ai-instructions", label: "Instruções" },
    ],
  },
  {
    id: "transcricao",
    label: "Transcrição",
    icon: "microphone",
    children: [
      { id: "whisper-model", label: "Modelo" },
      { id: "whisper-language", label: "Idioma" },
      { id: "whisper-advanced", label: "Avançado" },
      { id: "transcript-display", label: "Exibição" },
    ],
  },
  {
    id: "renderizacao",
    label: "Renderização",
    icon: "film",
    children: [
      { id: "ffmpeg-quality", label: "Qualidade" },
      { id: "ffmpeg-visual", label: "Visual do corte" },
      { id: "ffmpeg-audio", label: "Áudio" },
      { id: "ffmpeg-advanced", label: "Avançado" },
    ],
  },
];

/** Grupo lógico das ações fixas do rodapé da navegação (Processar em lote / Como usar). */
export const SETTINGS_FOOTER_GROUP_ID = "rodape";

export interface SectionMeta {
  title: string;
  groupId: string;
  /** Se o indicador "Salvo" do cabeçalho deve ser exibido para a seção. */
  showSaved: boolean;
}

export function getSectionMeta(id: SectionId): SectionMeta {
  if (id === "batch") {
    return { title: "Processar em lote", groupId: SETTINGS_FOOTER_GROUP_ID, showSaved: false };
  }
  if (id === "how-to-use") {
    return { title: "Como usar", groupId: SETTINGS_FOOTER_GROUP_ID, showSaved: false };
  }

  for (const group of SETTINGS_NAV_GROUPS) {
    if (group.leafId === id) {
      return { title: group.label, groupId: group.id, showSaved: true };
    }
    const child = group.children?.find((item) => item.id === id);
    if (child) {
      return { title: child.label, groupId: group.id, showSaved: true };
    }
  }

  return { title: "Configurações", groupId: SETTINGS_FOOTER_GROUP_ID, showSaved: true };
}

/* -------------------------------------------------------------------------- */
/* Autosave                                                                    */
/* -------------------------------------------------------------------------- */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type AutoSaveReporter = {
  reportSaving: () => void;
  reportSaved: () => void;
  reportError: (msg?: string) => void;
};

/** Valores persistíveis das telas "Aplicação" (campos opcionais = patch parcial). */
export type DownloadResolution = "1080p" | "1440p" | "4k";

export interface AppSettingsPatch {
  baseDir?: string;
  downloadResolution?: DownloadResolution;
  askDeleteCutConfirm?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Primitivas de UI                                                            */
/* -------------------------------------------------------------------------- */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function SettingsSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cx(
        "text-label font-medium uppercase tracking-[0.06em] text-text-3 mb-2.5",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/* ----------------------------- GhostButton -------------------------------- */

export interface GhostButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "accent";
  leadingIcon?: ReactNode;
}

export function GhostButton({
  variant = "default",
  leadingIcon,
  className,
  type = "button",
  children,
  ...rest
}: GhostButtonProps) {
  const variantClasses =
    variant === "accent"
      ? "border border-[rgba(91,156,255,0.45)] bg-transparent text-accent-soft hover:bg-[rgba(91,156,255,0.08)]"
      : "border border-line-strong bg-transparent text-text-2 hover:text-text-1 hover:bg-glass-hover";

  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-pill px-3 h-8 text-sm font-medium whitespace-nowrap",
        "transition-colors duration-fast disabled:opacity-50 disabled:pointer-events-none",
        variantClasses,
        className,
      )}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  );
}

/* ------------------------------- PickTile --------------------------------- */

export interface PickTileProps {
  selected: boolean;
  /** Seleciona o tile. Sem `onSelect` o tile é apenas visual. */
  onSelect?: () => void;
  /** Rótulo visível do botão de seleção exibido quando o tile NÃO está selecionado. */
  actionLabel?: string;
  /** Nome acessível do botão de seleção (usado quando não há `actionLabel` visível). */
  ariaLabel?: string;
  /** Controle extra no canto superior direito (ex.: menu `⋯`). */
  topRightAction?: ReactNode;
  disabled?: boolean;
  className?: string;
  /**
   * Conteúdo do tile. O conteúdo é `pointer-events-none` para que o clique
   * atravesse até o botão de seleção; controles interativos aninhados (select,
   * input, menu) devem usar `pointer-events-auto relative z-10`.
   */
  children?: ReactNode;
}

/**
 * Tile selecionável. Nunca aninha <button> dentro de <button>: o wrapper é um
 * <div data-pick-tile> e a seleção é um <button> irmão (overlay) do conteúdo.
 */
export function PickTile({
  selected,
  onSelect,
  actionLabel,
  ariaLabel,
  topRightAction,
  disabled,
  className,
  children,
}: PickTileProps) {
  const hasVisibleAction = Boolean(onSelect && actionLabel && !selected);

  return (
    <div
      data-pick-tile
      data-selected={selected ? "true" : "false"}
      className={cx(
        "relative flex flex-col rounded-card border border-line bg-glass p-4 text-left transition-[border-color,background-color,box-shadow] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        selected ? "pick" : onSelect && !disabled && "hover:bg-glass-hover hover:border-line-strong",
        disabled && "opacity-60",
        className,
      )}
    >
      {onSelect && (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={ariaLabel}
          aria-hidden={hasVisibleAction ? true : undefined}
          tabIndex={hasVisibleAction ? -1 : undefined}
          disabled={disabled}
          onClick={onSelect}
          className={cx(
            "absolute inset-0 z-0 rounded-card bg-transparent",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        />
      )}

      <div className="relative z-[1] flex flex-1 flex-col pointer-events-none">{children}</div>

      {hasVisibleAction && (
        <div className="relative z-10 mt-3 flex">
          <GhostButton onClick={onSelect} disabled={disabled} className="h-7 px-3 text-xs">
            {actionLabel}
          </GhostButton>
        </div>
      )}

      {(selected || topRightAction) && (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
          {topRightAction}
          {selected && (
            <span
              aria-hidden="true"
              className="pick-check-badge w-[18px] h-[18px] rounded-full bg-accent-soft text-[#0a0b0d] flex items-center justify-center"
            >
              <Check size={11} weight="bold" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- PickTileGroup ------------------------------ */

export interface PickTileGroupProps {
  children: ReactNode;
  className?: string;
}

/**
 * Container para grupos de tiles selecionáveis (`PickTile`).
 * A transição suave de borda, fundo e barra lateral acontece em cada card individualmente.
 */
export function PickTileGroup({ children, className }: PickTileGroupProps) {
  return <div className={className}>{children}</div>;
}

/* ------------------------------- FormatChip ------------------------------- */

export interface FormatChipProps {
  label: string;
  selected: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  className?: string;
  /** Com `role="radio"` o chip usa `aria-checked` (uso dentro de `SegmentedChoice`). */
  role?: "radio";
  tabIndex?: number;
}

/** Chip de formato. Selecionado = contorno azul sutil e fundo leve. */
export function FormatChip({
  label,
  selected,
  onToggle,
  disabled,
  className,
  role,
  tabIndex,
}: FormatChipProps) {
  return (
    <button
      type="button"
      role={role}
      tabIndex={tabIndex}
      aria-pressed={role === "radio" ? undefined : selected}
      aria-checked={role === "radio" ? selected : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "inline-flex items-center justify-center rounded-pill border px-3 h-7 text-xs font-medium tabular-nums",
        "transition-[border-color,background-color,color,box-shadow,transform] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97]",
        "disabled:opacity-50 disabled:pointer-events-none",
        selected
          ? "border-[rgba(91,156,255,0.85)] bg-[rgba(91,156,255,0.08)] shadow-[0_0_0_1px_rgba(91,156,255,0.18)] text-text-1"
          : "border-line-strong bg-transparent text-text-2 hover:text-text-1 hover:bg-glass-hover",
        className,
      )}
    >
      {label}
    </button>
  );
}

/* ------------------------------- StatusDot -------------------------------- */

export type StatusTone = "success" | "warning" | "cloud" | "danger" | "neutral";

const STATUS_DOT_COLOR: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  cloud: "bg-accent-soft",
  danger: "bg-danger",
  neutral: "bg-text-3",
};

const STATUS_TEXT_COLOR: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  cloud: "text-accent-soft",
  danger: "text-danger",
  neutral: "text-text-2",
};

export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm", STATUS_TEXT_COLOR[tone], className)}>
      <span
        aria-hidden="true"
        className={cx("inline-block h-[6px] w-[6px] shrink-0 rounded-full", STATUS_DOT_COLOR[tone])}
      />
      <span>{label}</span>
    </span>
  );
}

/* ----------------------------- SettingsSwitch ----------------------------- */

export interface SettingsSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  className?: string;
}

export function SettingsSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className,
}: SettingsSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-pill transition-colors duration-fast",
        "disabled:opacity-50 disabled:pointer-events-none",
        checked ? "bg-accent" : "bg-[rgba(255,255,255,0.14)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-fast",
          checked ? "translate-x-[19px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

/* ------------------------ Restaurar configurações ------------------------- */

export type RestoreScope = SectionId | "all";

export interface PendingRestoreEntry {
  startedAt: number;
  durationMs: number;
}

export type PendingRestoreMap = Partial<Record<RestoreScope, PendingRestoreEntry>>;

export type PendingRestoreState = PendingRestoreMap;

export const RESTORABLE_SECTIONS: ReadonlyArray<SectionId> = [
  "app-folders",
  "app-download",
  "ai-model",
  "ai-search",
  "ai-instructions",
  "whisper-model",
  "whisper-language",
  "whisper-advanced",
  "ffmpeg-quality",
  "ffmpeg-visual",
  "ffmpeg-audio",
  "ffmpeg-advanced",
  "watermark",
];

export interface RestoreDefaultsButtonProps {
  scope: RestoreScope;
  label?: string;
  confirmTitle?: string;
  confirmDescription?: string;
  pending?: PendingRestoreEntry;
  onConfirmStart: (scope: RestoreScope) => void;
  onCancelPending: (scope: RestoreScope) => void;
  variant?: "section" | "sidebar";
  className?: string;
}

interface PopoverCoords {
  top: number;
  left: number;
}

const POPOVER_MARGIN = 12;
const POPOVER_GAP = 8;

export function RestoreDefaultsButton({
  scope,
  label = "Restaurar padrão",
  confirmTitle = "Tem certeza que deseja restaurar esta seção?",
  confirmDescription,
  pending,
  onConfirmStart,
  onCancelPending,
  variant = "section",
  className,
}: RestoreDefaultsButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const pendingStartedAt = pending?.startedAt;
  const pendingDurationMs = pending?.durationMs;
  const pendingAnimationDelayMs = useMemo(() => {
    if (pendingStartedAt === undefined || pendingDurationMs === undefined) return 0;
    return Math.max(0, Math.min(pendingDurationMs, Date.now() - pendingStartedAt));
  }, [pendingStartedAt, pendingDurationMs]);

  useEffect(() => {
    if (pending) {
      setMenuOpen(false);
    }
  }, [pending]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverEl = popoverRef.current;
    const popoverWidth = popoverEl?.offsetWidth || 264;
    const popoverHeight = popoverEl?.offsetHeight || 116;

    const maxLeft = Math.max(POPOVER_MARGIN, window.innerWidth - popoverWidth - POPOVER_MARGIN);
    const preferredLeft =
      variant === "sidebar" ? triggerRect.left : triggerRect.right - popoverWidth;
    const left = Math.max(POPOVER_MARGIN, Math.min(maxLeft, preferredLeft));

    const spaceBelow = window.innerHeight - triggerRect.bottom - POPOVER_MARGIN;
    const spaceAbove = triggerRect.top - POPOVER_MARGIN;
    let top: number;
    if (spaceBelow >= popoverHeight + POPOVER_GAP || spaceBelow >= spaceAbove) {
      top = Math.min(
        window.innerHeight - popoverHeight - POPOVER_MARGIN,
        triggerRect.bottom + POPOVER_GAP,
      );
    } else {
      top = Math.max(POPOVER_MARGIN, triggerRect.top - popoverHeight - POPOVER_GAP);
    }

    setCoords((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [variant]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    updatePosition();
  }, [menuOpen, updatePosition, confirmTitle, confirmDescription]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerOutside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleViewportChange = () => {
      updatePosition();
    };

    document.addEventListener("pointerdown", handlePointerOutside, true);
    document.addEventListener("mousedown", handlePointerOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerOutside, true);
      document.removeEventListener("mousedown", handlePointerOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [menuOpen, updatePosition]);

  const handleTriggerClick = () => {
    if (!menuOpen) {
      updatePosition();
    }
    setMenuOpen((prev) => !prev);
  };

  const handleConfirm = () => {
    setMenuOpen(false);
    onConfirmStart(scope);
  };

  if (pending) {
    const cancelClasses =
      variant === "sidebar"
        ? "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item border border-[rgba(91,156,255,0.45)] text-sm text-left text-text-1"
        : "inline-flex items-center justify-center gap-1.5 rounded-pill border border-[rgba(91,156,255,0.45)] px-3 h-8 text-sm font-medium whitespace-nowrap text-text-1";

    return (
      <button
        type="button"
        onClick={() => onCancelPending(scope)}
        className={cx(
          "relative overflow-hidden transition-colors duration-fast hover:border-[rgba(91,156,255,0.7)]",
          cancelClasses,
          className,
        )}
      >
        <span
          key={pending.startedAt}
          aria-hidden="true"
          className="restore-fill-bar pointer-events-none absolute inset-0 bg-[rgba(91,156,255,0.28)]"
          style={{
            animation: `restore-fill-sweep ${pending.durationMs}ms linear forwards`,
            animationDelay: `-${pendingAnimationDelayMs}ms`,
          }}
        />
        <span className="relative z-[1] inline-flex items-center gap-1.5 min-w-0">
          <X size={14} weight="regular" className="shrink-0" />
          <span className="truncate">Cancelar</span>
        </span>
      </button>
    );
  }

  const triggerClasses =
    variant === "sidebar"
      ? "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item text-sm text-left text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
      : "inline-flex items-center justify-center gap-1.5 rounded-pill border border-line-strong bg-transparent px-3 h-8 text-sm font-medium whitespace-nowrap text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={handleTriggerClick}
        className={cx(triggerClasses, className)}
      >
        <ArrowCounterClockwise size={14} weight="regular" className="shrink-0" />
        <span className="truncate">{label}</span>
      </button>

      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={confirmTitle}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
            className="z-[90] w-[264px] max-w-[calc(100vw-24px)] glass--strong rounded-card p-3 shadow-pop"
          >
            <p className="text-xs font-medium text-text-1 leading-snug">{confirmTitle}</p>
            {confirmDescription && (
              <p className="mt-1 text-xs text-text-2 leading-relaxed">{confirmDescription}</p>
            )}
            <div className="mt-3 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="h-7 rounded-pill px-2.5 text-xs font-medium text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="h-7 rounded-pill bg-accent hover:bg-accent-hover active:bg-accent-active px-3 text-xs font-medium text-white transition-colors duration-fast"
              >
                Confirmar
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Cartão de configuração, controle deslizante, escolha segmentada e grade     */
/* -------------------------------------------------------------------------- */

/** Mesmas classes do `CARD_CLASS` privado de `AppAndDepsSections.tsx`. */
export const SETTINGS_CARD_CLASS = "rounded-card border border-line bg-glass";

/* ----------------------------- SettingsSlider ----------------------------- */

export interface SettingsSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  ariaLabel: string;
  /** Texto lido por leitores de tela (ex.: "30 por cento"). */
  ariaValueText?: string;
  /** Texto exibido ao lado (ex.: "30%"). */
  valueLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Trilha de 4 px, preenchimento de acento e botão branco de 12 px. O
 * `<input type="range">` fica por baixo (transparente) e cuida do teclado.
 */
export function SettingsSlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
  ariaValueText,
  valueLabel,
  disabled,
  className,
}: SettingsSliderProps) {
  const span = max - min;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;

  return (
    <div className={cx("flex items-center gap-3", disabled && "opacity-50", className)}>
      <div className="relative h-4 flex-1">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-white/[0.18]"
        >
          <div className="h-full rounded-pill bg-accent" style={{ width: `${ratio * 100}%` }} />
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: `${ratio * 100}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
          onChange={(event) => onChange(Number(event.target.value))}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-pill peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring"
        />
      </div>
      {valueLabel !== undefined && (
        <span className="w-10 shrink-0 text-right text-sm text-text-2 tabular-nums">
          {valueLabel}
        </span>
      )}
    </div>
  );
}

/* ---------------------------- SegmentedChoice ----------------------------- */

export interface SegmentedChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedChoiceProps<T extends string> {
  options: ReadonlyArray<SegmentedChoiceOption<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/** Fileira de `FormatChip` com `role="radiogroup"` e setas do teclado. */
export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SegmentedChoiceProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const index = options.findIndex((option) => option.value === value);
    const nextIndex = (Math.max(0, index) + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[nextIndex].value);
    window.requestAnimationFrame(() => {
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
    });
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cx("flex flex-wrap items-center gap-2", className)}
    >
      {options.map((option) => (
        <FormatChip
          key={option.value}
          role="radio"
          label={option.label}
          selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={disabled}
          onToggle={() => onChange(option.value)}
        />
      ))}
    </div>
  );
}

/* ------------------------------ PositionGrid ------------------------------ */

export const POSITION_GRID_OPTIONS = [
  { value: "top-left", label: "Canto superior esquerdo" },
  { value: "top-center", label: "Topo ao centro" },
  { value: "top-right", label: "Canto superior direito" },
  { value: "middle-left", label: "Meio à esquerda" },
  { value: "center", label: "Centro" },
  { value: "middle-right", label: "Meio à direita" },
  { value: "bottom-left", label: "Canto inferior esquerdo" },
  { value: "bottom-center", label: "Base ao centro" },
  { value: "bottom-right", label: "Canto inferior direito" },
] as const;

export interface PositionGridProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Grade 3×3 de botões de 28 px. O escolhido usa o estilo de `[data-pick-tile]` selecionado. */
export function PositionGrid<T extends string = string>({
  value,
  onChange,
  ariaLabel = "Posição",
  disabled,
  className,
}: PositionGridProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const delta: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    };
    const step = delta[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = Math.max(
      0,
      POSITION_GRID_OPTIONS.findIndex((option) => option.value === value),
    );
    const column = index % 3;
    if ((step === -1 && column === 0) || (step === 1 && column === 2)) return;
    const nextIndex = index + step;
    if (nextIndex < 0 || nextIndex > 8) return;
    onChange(POSITION_GRID_OPTIONS[nextIndex].value as T);
    window.requestAnimationFrame(() => {
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus();
    });
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cx("inline-grid grid-cols-3 gap-1.5", className)}
    >
      {POSITION_GRID_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            data-pick-tile
            data-selected={selected ? "true" : "false"}
            onClick={() => onChange(option.value as T)}
            className={cx(
              "h-7 w-7 rounded-thumb border border-line transition-colors duration-fast",
              "disabled:opacity-50 disabled:pointer-events-none",
              "focus-visible:ring-2 focus-visible:ring-accent-ring",
              selected ? "pick" : "bg-glass hover:bg-glass-hover hover:border-line-strong",
            )}
          />
        );
      })}
    </div>
  );
}
