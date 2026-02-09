import { useState } from "react";
import type { ActionState } from "../hooks/useAppAction";

interface LLMConfigDialogProps {
  llmSystemPrompt: string;
  action: ActionState;
  onSave: (prompt: string) => void;
  onCancel: () => void;
}

export function LLMConfigDialog({
  llmSystemPrompt: initialPrompt,
  action,
  onSave,
  onCancel,
}: LLMConfigDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <div className="dialog-header">
          <h3>🤖 Configurar LLM</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onCancel}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              System Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: "100%",
                minHeight: "400px",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                fontFamily: "monospace",
                fontSize: "12px",
                resize: "vertical",
                boxSizing: "border-box",
              }}
              placeholder="Cole o system prompt aqui..."
            />
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <button
              onClick={() => onSave(prompt)}
              disabled={action.busy}
              className="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              ✓ Salvar
            </button>
            <button
              onClick={onCancel}
              className="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
