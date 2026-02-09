import type { ActionState } from "../hooks/useAppAction";

interface TranscriptionDeleteDialogProps {
  pendingDeleteFormat: "text" | "vtt" | "segments";
  action: ActionState;
  onConfirm: (format: "text" | "vtt" | "segments") => void;
  onCancel: () => void;
}

function formatLabel(format: "text" | "vtt" | "segments"): string {
  if (format === "segments") return "JSON";
  return format.toUpperCase();
}

export function TranscriptionDeleteDialog({
  pendingDeleteFormat,
  action,
  onConfirm,
  onCancel,
}: TranscriptionDeleteDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Confirmar exclusão</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onCancel}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <p>
            Tem certeza que deseja deletar a transcrição em formato{" "}
            <strong>{formatLabel(pendingDeleteFormat)}</strong>?
          </p>
          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button
              className="danger"
              disabled={action.busy}
              onClick={() => onConfirm(pendingDeleteFormat)}
            >
              Confirmar
            </button>
            <button className="secondary" onClick={onCancel}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
