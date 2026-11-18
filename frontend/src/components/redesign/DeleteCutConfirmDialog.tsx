import { useEffect, useId, useRef, type SyntheticEvent } from "react";

interface DeleteCutConfirmDialogProps {
  open: boolean;
  cutTitle?: string | null;
  dontAskAgain: boolean;
  onDontAskAgainChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteCutConfirmDialog({
  open,
  cutTitle,
  dontAskAgain,
  onDontAskAgainChange,
  onClose,
  onConfirm,
}: DeleteCutConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const checkboxId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open) {
      if (!el.open) {
        el.showModal();
        cancelButtonRef.current?.focus();
      }
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el || !open) return;
    if ("closedBy" in HTMLDialogElement.prototype) return;

    let pointerDownOutside = false;

    const isOutside = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!el.open) return;
      pointerDownOutside = isOutside(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!el.open) return;
      if (pointerDownOutside && isOutside(event.clientX, event.clientY)) {
        pointerDownOutside = false;
        onClose();
      } else {
        pointerDownOutside = false;
      }
    };

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointerup", handlePointerUp);
    return () => {
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointerup", handlePointerUp);
    };
  }, [open, onClose]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dialogRef.current) {
      dialogRef.current.returnValue = "";
    }
    onClose();
  };

  const handleClose = () => {
    if (dialogRef.current) {
      dialogRef.current.returnValue = "";
    }
    if (open) {
      onClose();
    }
  };

  const trimmedTitle = cutTitle?.trim();
  const description = trimmedTitle
    ? `Tem certeza que deseja apagar o corte "${trimmedTitle}"? Essa ação remove o corte da lista.`
    : "Tem certeza que deseja apagar o corte selecionado? Essa ação remove o corte da lista.";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={handleCancel}
      onClose={handleClose}
      {...({ closedby: "any" } as Record<string, string>)}
      className="max-w-[420px] w-[calc(100vw-2rem)] m-auto p-0 bg-transparent border-0 rounded-panel text-text-1 open:flex open:flex-col"
    >
      <div className="glass--strong border border-line-strong rounded-panel shadow-pop text-text-1 p-5 space-y-4 w-full">
        <div className="space-y-1.5">
          <h2 id={titleId} className="text-md font-semibold text-text-1 m-0">
            Apagar corte?
          </h2>
          <p id={descId} className="text-sm text-text-2 leading-relaxed m-0">
            {description}
          </p>
        </div>

        <label
          htmlFor={checkboxId}
          className="inline-flex items-center gap-2.5 min-h-[44px] cursor-pointer select-none text-xs text-text-2"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => onDontAskAgainChange(e.target.checked)}
            className="accent-[var(--accent)] w-[1.15em] h-[1.15em] m-0 cursor-pointer shrink-0"
          />
          <span>Não perguntar novamente</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            ref={cancelButtonRef}
            type="button"
            autoFocus
            onClick={onClose}
            className="h-9 px-4 rounded-pill text-xs font-medium text-text-2 hover:text-text-1 hover:bg-glass-hover border border-line transition-colors duration-fast"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 px-4 rounded-pill text-xs font-medium bg-danger-bg text-danger border border-danger/30 hover:bg-danger/20 transition-colors duration-fast"
          >
            Apagar corte
          </button>
        </div>
      </div>
    </dialog>
  );
}
