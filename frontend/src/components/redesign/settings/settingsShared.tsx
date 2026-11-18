import { Check } from "@phosphor-icons/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

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
  | "ffmpeg-quality"
  | "ffmpeg-visual"
  | "ffmpeg-audio"
  | "ffmpeg-advanced"
  | "batch"
  | "how-to-use";

export type NavIconName = "gear" | "cpu" | "sparkle" | "microphone" | "film";

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
        "relative flex flex-col rounded-card border border-line bg-glass p-4 text-left transition-[border-color,background-color,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
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

interface RailPosition {
  x: number;
  y: number;
  h: number;
  visible: boolean;
}

/**
 * Agrupa tiles de seleção única (`PickTile`) e anima um trilho indicador
 * compartilhado entre o tile anterior e o próximo entre colunas e linhas.
 */
export function PickTileGroup({ children, className }: PickTileGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<RailPosition>({ x: 0, y: 0, h: 0, visible: false });
  const [canAnimate, setCanAnimate] = useState(false);

  const measure = useCallback(() => {
    const container = groupRef.current;
    if (!container) return;

    const selected = container.querySelector<HTMLElement>(
      '[data-pick-tile][data-selected="true"]',
    );
    if (!selected) {
      setPos((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      setCanAnimate(false);
      return;
    }

    let x = selected.offsetLeft;
    let y = selected.offsetTop;
    if (selected.offsetParent && selected.offsetParent !== container) {
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      x = selectedRect.left - containerRect.left + container.scrollLeft;
      y = selectedRect.top - containerRect.top + container.scrollTop;
    }

    const inset = Math.min(8, Math.floor(selected.offsetHeight / 4));
    const next: RailPosition = {
      x,
      y: y + inset,
      h: Math.max(0, selected.offsetHeight - inset * 2),
      visible: true,
    };

    setPos((prev) => {
      if (
        prev.x === next.x &&
        prev.y === next.y &&
        prev.h === next.h &&
        prev.visible === next.visible
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [children, measure]);

  useLayoutEffect(() => {
    if (!pos.visible) {
      setCanAnimate(false);
      return;
    }
    if (canAnimate) return;
    const raf = window.requestAnimationFrame(() => {
      setCanAnimate(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pos.visible, canAnimate]);

  useLayoutEffect(() => {
    const container = groupRef.current;
    if (!container) return;

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (resizeObserver) {
      resizeObserver.observe(container);
      container.querySelectorAll<HTMLElement>("[data-pick-tile]").forEach((tile) => {
        resizeObserver.observe(tile);
      });
    }

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            if (resizeObserver) {
              container.querySelectorAll<HTMLElement>("[data-pick-tile]").forEach((tile) => {
                resizeObserver.observe(tile);
              });
            }
            measure();
          })
        : null;
    if (mutationObserver) {
      mutationObserver.observe(container, {
        attributes: true,
        attributeFilter: ["data-selected", "class", "style"],
        childList: true,
        subtree: true,
      });
    }

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure]);

  return (
    <div ref={groupRef} data-pick-group="true" className={cx("relative", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cx(
          "pick-group-rail w-[2.5px] rounded-full bg-accent-soft transition-[transform,height,opacity] duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          !canAnimate && "!transition-none",
        )}
        style={{
          transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
          height: `${pos.h}px`,
          opacity: pos.visible ? 1 : 0,
        }}
      />
    </div>
  );
}

/* ------------------------------- FormatChip ------------------------------- */

export interface FormatChipProps {
  label: string;
  selected: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  className?: string;
}

/** Chip de formato. Selecionado = SOMENTE contorno azul (sem ícone/check/fill/trilho). */
export function FormatChip({ label, selected, onToggle, disabled, className }: FormatChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "inline-flex items-center justify-center rounded-pill px-3 h-7 text-xs font-medium tabular-nums",
        "transition-colors duration-fast disabled:opacity-50 disabled:pointer-events-none",
        selected
          ? "border border-[rgba(91,156,255,0.8)] bg-transparent text-text-1"
          : "border border-line-strong bg-transparent text-text-2 hover:text-text-1 hover:bg-glass-hover",
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
