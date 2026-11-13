import { useState } from "react";
import type { ActionState } from "../../hooks/useAppAction";
import { AppButton, AppDialog, AppInput } from "../shared";

interface RenameVideoDialogProps {
  videoName: string;
  action: ActionState;
  onSave: (newName: string) => void;
  onCancel: () => void;
}

export function RenameVideoDialog({
  videoName: initialName,
  action,
  onSave,
  onCancel,
}: RenameVideoDialogProps) {
  const [newName, setNewName] = useState(initialName);

  const handleSave = () => {
    if (newName.trim()) {
      onSave(newName.trim());
    }
  };

  return (
    <AppDialog
      title="Renomear Vídeo"
      onClose={onCancel}
      className="max-w-lg"
      footer={
        <AppButton
          variant="secondary"
          disabled={action.busy || !newName.trim()}
          onClick={handleSave}
        >
          {action.busy ? "Renomeando..." : "Renomear"}
        </AppButton>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-xs text-zinc-400 leading-relaxed m-0">
          <strong className="text-zinc-200">Importante:</strong> Não renomeie os arquivos no seu computador. Use apenas esta
          interface para manter a sincronia entre o vídeo, transcrições e shorts gerados.
        </p>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1.5">
            Nome do arquivo
          </label>
          <AppInput
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Digite o novo nome do vídeo"
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim() && !action.busy) {
                handleSave();
              }
            }}
          />
        </div>
      </div>
    </AppDialog>
  );
}
