interface FloatingChromeProps {
  sidebarPinned?: boolean;
  sidebarOpen?: boolean;
  sidebarSide?: "left" | "right";
  immersiveCutTitle: string | null;
  onExitImmersive: () => void;
  onOpenSettings?: () => void;
}

export function FloatingChrome({
  immersiveCutTitle,
  onExitImmersive,
}: FloatingChromeProps) {
  if (!immersiveCutTitle) {
    return null;
  }

  return (
    /* Pílula centralizada do modo imersivo */
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
  );
}
