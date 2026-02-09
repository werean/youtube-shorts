import { useState } from "react";
import type { ActionState } from "../hooks/useAppAction";

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

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Renomear Vídeo</h3>
        <p style={{ color: "#666", marginBottom: "15px" }}>
          ⚠️ <strong>Importante:</strong> Não renomeie os arquivos no seu computador. Use apenas
          esta interface para manter a associação entre o vídeo, transcrições e shorts gerados.
        </p>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Digite o novo nome do vídeo"
          style={{
            width: "100%",
            padding: "10px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            marginBottom: "15px",
            boxSizing: "border-box",
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              onSave(newName);
            }
          }}
        />
        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancelar</button>
          <button
            className="primary"
            disabled={action.busy || !newName.trim()}
            onClick={() => {
              if (newName.trim()) {
                onSave(newName);
              }
            }}
          >
            Renomear
          </button>
        </div>
      </div>
    </div>
  );
}
