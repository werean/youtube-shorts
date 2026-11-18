import { useEffect, useId, useState } from "react";
import { GlassDialog } from "./GlassDialog";

interface WatermarkAskDialogProps {
  open: boolean;
  /** Endereço absoluto da imagem da marca (miniatura de 48×48). */
  imageUrl: string | null;
  onAnswer: (addWatermark: boolean, dontAskAgain: boolean) => void;
  /** Esc, X ou clique fora: cancela o clique original; nada é gerado. */
  onCancel: () => void;
}

/** Pergunta feita antes de cada renderização quando o modo é "Perguntar antes". */
export function WatermarkAskDialog({
  open,
  imageUrl,
  onAnswer,
  onCancel,
}: WatermarkAskDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const checkboxId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) setDontAskAgain(false);
  }, [open]);

  return (
    <GlassDialog
      open={open}
      descriptionId={descriptionId}
      title="Adicionar a marca d'água?"
      width={420}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={() => onAnswer(false, dontAskAgain)}
            className="h-9 px-4 rounded-pill bg-white/[0.06] border border-line text-text-1 text-base font-medium hover:bg-white/[0.12] transition-colors duration-fast"
          >
            Sem marca d'água
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => onAnswer(true, dontAskAgain)}
            className="h-9 px-4 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active transition-colors duration-fast"
          >
            Adicionar
          </button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-white/[0.04]"
        >
          {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-contain" />}
        </span>
        <p id={descriptionId} className="text-sm text-text-2 leading-relaxed m-0">
          Os vídeos gerados agora vão sair com a sua marca.
        </p>
      </div>

      <label
        htmlFor={checkboxId}
        className="mt-3 inline-flex items-center gap-2.5 min-h-[44px] cursor-pointer select-none text-xs text-text-2"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={dontAskAgain}
          onChange={(e) => setDontAskAgain(e.target.checked)}
          className="accent-[var(--accent)] w-[1.15em] h-[1.15em] m-0 cursor-pointer shrink-0"
        />
        <span>Não perguntar novamente</span>
      </label>
    </GlassDialog>
  );
}
