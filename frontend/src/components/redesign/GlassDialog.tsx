import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

interface GlassDialogProps {
  open: boolean;
  /** Id do parágrafo que descreve o diálogo (aria-describedby). */
  descriptionId?: string;
  title: string;
  onClose: () => void;
  /** Largura máxima do painel em px. Padrão: 460. */
  width?: number;
  /** Impede fechar por Esc, clique fora e botão X (ex.: operação em andamento). */
  disableClose?: boolean;
  /** Rodapé alinhado à direita (botões). */
  footer?: ReactNode;
  children?: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Casca dos diálogos de vidro: mesma marcação do `NewVideoModal`
 * (fundo, painel, título, botão X, Esc e clique fora), com foco preso
 * e devolvido ao elemento que abriu o diálogo.
 */
export function GlassDialog({
  open,
  descriptionId,
  title,
  onClose,
  width = 460,
  disableClose = false,
  footer,
  children,
}: GlassDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disableClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !panelRef.current.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !panelRef.current.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open, disableClose, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={() => {
        if (!disableClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{ maxWidth: width }}
        className="w-full rounded-panel glass--strong p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-base font-medium text-text-1">
            {title}
          </h2>
          <button
            type="button"
            disabled={disableClose}
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-40 transition-colors duration-fast"
          >
            <X size={15} weight="regular" />
          </button>
        </div>

        {children}

        {footer && <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
