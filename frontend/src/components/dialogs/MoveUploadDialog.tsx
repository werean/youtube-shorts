import { AppButton, AppDialog } from "../shared";

interface MoveUploadDialogProps {
  onClose: () => void;
  onConfirmMove: () => void;
  onConfirmKeep: () => void;
}

export function MoveUploadDialog({ onClose, onConfirmMove, onConfirmKeep }: MoveUploadDialogProps) {
  return (
    <AppDialog
      title="Mover vídeo para a pasta configurada?"
      onClose={onClose}
      className="max-w-md"
      footer={
        <div className="flex gap-2">
          <AppButton variant="primary" onClick={onConfirmKeep}>
            Manter cópia
          </AppButton>
          <AppButton variant="secondary" onClick={onConfirmMove}>
            Mover e enviar
          </AppButton>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <p className="text-sm text-zinc-300 leading-relaxed m-0">
          Deseja mover o vídeo selecionado para a pasta configurada para economizar espaço e evitar uma cópia extra em disco?
        </p>
      </div>
    </AppDialog>
  );
}
