import { ArrowLeft, ArrowRight, Gear } from "@phosphor-icons/react";

interface FloatingChromeProps {
  sidebarPinned: boolean;
  sidebarOpen: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  immersiveCutTitle: string | null;
  onGoBack: () => void;
  onGoForward: () => void;
  onExitImmersive: () => void;
  onOpenSettings: () => void;
}

export function FloatingChrome({
  sidebarPinned,
  sidebarOpen,
  canGoBack,
  canGoForward,
  immersiveCutTitle,
  onGoBack,
  onGoForward,
  onExitImmersive,
  onOpenSettings,
}: FloatingChromeProps) {
  const showTopLeftArrows = !sidebarPinned && !sidebarOpen;

  return (
    <>
      {/* Pílula de setas no canto superior esquerdo (só quando a barra está oculta) */}
      {showTopLeftArrows && !immersiveCutTitle && (
        <div className="fixed top-4 left-4 z-chrome inline-flex items-center gap-0.5 h-8 px-1 rounded-pill glass transition-opacity duration-base ease-out">
          <button
            type="button"
            onClick={onGoBack}
            disabled={!canGoBack}
            aria-label="Vídeo anterior no histórico"
            className="grid h-6 w-6 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-fast"
          >
            <ArrowLeft size={15} weight="regular" />
          </button>
          <button
            type="button"
            onClick={onGoForward}
            disabled={!canGoForward}
            aria-label="Próximo vídeo no histórico"
            className="grid h-6 w-6 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-fast"
          >
            <ArrowRight size={15} weight="regular" />
          </button>
        </div>
      )}

      {/* Pílula centralizada do modo imersivo */}
      {immersiveCutTitle && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-chrome inline-flex items-center gap-3 h-8 px-3.5 rounded-pill glass max-w-[min(560px,80vw)]">
          <span className="text-sm text-text-1 truncate">
            Corte: {immersiveCutTitle}
          </span>
          <button
            type="button"
            onClick={onExitImmersive}
            className="text-sm font-medium text-accent-soft hover:underline shrink-0"
          >
            Voltar ao vídeo original
          </button>
        </div>
      )}

      {/* Engrenagem flutuante no canto superior direito */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Configurações"
        className="fixed top-4 right-4 z-chrome grid h-8 w-8 place-items-center rounded-pill glass text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
      >
        <Gear size={16} weight="regular" />
      </button>
    </>
  );
}
