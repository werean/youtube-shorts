import type { ActionState } from "../../hooks/useAppAction";
import { AppButton, AppDialog } from "../shared";

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
    <AppDialog
      title="Confirmar exclusão"
      onClose={onCancel}
      showHeaderClose={false}
      footer={
        <>
          <AppButton variant="primary" onClick={onCancel} disabled={action.busy}>
            Cancelar
          </AppButton>
          <AppButton
            variant="default"
            className="danger"
            onClick={() => onConfirm(pendingDeleteFormat)}
            disabled={action.busy}
          >
            {action.busy ? "Excluindo..." : "Confirmar"}
          </AppButton>
        </>
      }
    >
      <p>
        Tem certeza que deseja deletar a transcrição em formato{" "}
        <strong>{formatLabel(pendingDeleteFormat)}</strong>?
      </p>
    </AppDialog>
  );
}

