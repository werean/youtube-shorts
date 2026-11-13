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
      className="max-w-md"
      footer={
        <AppButton
          variant="default"
          className="danger"
          onClick={() => onConfirm(pendingDeleteFormat)}
          disabled={action.busy}
        >
          {action.busy ? "Excluindo..." : "Confirmar exclusão"}
        </AppButton>
      }
    >
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-300 leading-relaxed m-0">
          Tem certeza que deseja deletar a transcrição em formato{" "}
          <strong className="text-white">{formatLabel(pendingDeleteFormat)}</strong>?
        </p>
        <p className="text-xs text-zinc-400 m-0">
          Esta operação removerá o arquivo correspondente no disco permanentemente.
        </p>
      </div>
    </AppDialog>
  );
}
