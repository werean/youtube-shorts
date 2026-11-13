import { useEffect, type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface AppDialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  showHeaderClose?: boolean;
  wide?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
  scrollable?: boolean;
  disableClose?: boolean;
  onOverlayClick?: () => void;
  className?: string;
}

export function AppDialog({
  title,
  description,
  onClose,
  children,
  footer,
  showHeaderClose = true,
  wide = false,
  size,
  scrollable = false,
  disableClose = false,
  onOverlayClick,
  className,
}: AppDialogProps) {
  // Tecla Escape para fechar o modal
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableClose) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, disableClose]);

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-xl",
    xl: "max-w-2xl",
    "2xl": "max-w-3xl",
    "3xl": "max-w-4xl",
    "4xl": "max-w-5xl",
    "5xl": "max-w-6xl",
  };

  const maxWidthClass = size
    ? sizeClasses[size]
    : wide
      ? "max-w-4xl"
      : "max-w-xl";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 dialog-overlay app-dialog-overlay"
      onClick={() => {
        if (!disableClose) {
          (onOverlayClick || onClose)();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        className={cn(
          "relative flex flex-col w-full rounded-2xl border border-white/[0.12] bg-[#0c0c0e]/95 shadow-[0_24px_70px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.12)] backdrop-blur-2xl text-white font-sans max-h-[90vh] overflow-hidden overscroll-contain transition-all duration-200 dialog app-dialog",
          maxWidthClass,
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header Liquid Glass com tipografia moderna */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.015] flex-none dialog-header app-dialog-header">
          <div className="flex flex-col gap-1 min-w-0 pr-4">
            <h3
              id="app-dialog-title"
              className="text-base font-semibold tracking-tight text-white font-sans truncate"
            >
              {title}
            </h3>
            {description && (
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">{description}</p>
            )}
          </div>
          {showHeaderClose ? (
            <div className="dialog-actions app-dialog-actions flex-shrink-0">
              <button
                type="button"
                className="rounded-xl p-1.5 text-zinc-400 hover:text-white hover:bg-white/[0.08] border border-transparent hover:border-white/10 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 disabled:opacity-40"
                onClick={onClose}
                disabled={disableClose}
                aria-label="Fechar"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>

        {/* Conteúdo com scrollbar estável e espaçamento consistente */}
        <div
          className={cn(
            "flex-1 min-h-0 overflow-y-auto px-6 py-5 text-xs text-zinc-300 font-sans space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-stable overscroll-contain dialog-content app-dialog-content",
            scrollable && "max-h-[75vh]",
          )}
        >
          {children}
        </div>

        {/* Footer com botões e ações */}
        {footer ? (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-white/[0.02] flex-none dialog-footer app-dialog-footer">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
