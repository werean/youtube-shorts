import { useState } from "react";
import type { ActionState } from "../hooks/useAppAction";

interface CutEditDialogProps {
  editCutStartMinutes: string;
  editCutStartSeconds: string;
  editCutEndMinutes: string;
  editCutEndSeconds: string;
  action: ActionState;
  onSave: (startMin: number, startSec: number, endMin: number, endSec: number) => void;
  onCancel: () => void;
}

export function CutEditDialog({
  editCutStartMinutes: initialStartMinutes,
  editCutStartSeconds: initialStartSeconds,
  editCutEndMinutes: initialEndMinutes,
  editCutEndSeconds: initialEndSeconds,
  action,
  onSave,
  onCancel,
}: CutEditDialogProps) {
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [startSeconds, setStartSeconds] = useState(initialStartSeconds);
  const [endMinutes, setEndMinutes] = useState(initialEndMinutes);
  const [endSeconds, setEndSeconds] = useState(initialEndSeconds);

  const handleSave = () => {
    const startMin = Number(startMinutes);
    const startSec = Number(startSeconds);
    const endMin = Number(endMinutes);
    const endSec = Number(endSeconds);

    if (
      !Number.isFinite(startMin) ||
      !Number.isFinite(startSec) ||
      !Number.isFinite(endMin) ||
      !Number.isFinite(endSec)
    ) {
      alert("Todos os campos devem ser números.");
      return;
    }

    if (startMin < 0 || startSec < 0 || startSec > 59 || endMin < 0 || endSec < 0 || endSec > 59) {
      alert("Minutos devem ser >= 0, segundos 0-59.");
      return;
    }

    const startValue = startMin * 60 + startSec;
    const endValue = endMin * 60 + endSec;

    if (endValue <= startValue) {
      alert("O fim precisa ser maior que o início.");
      return;
    }

    onSave(startMin, startSec, endMin, endSec);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Editar timestamp</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onCancel}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <label className="field">
              Início - Minutos
              <input
                type="number"
                min="0"
                value={startMinutes}
                onChange={(event) => setStartMinutes(event.target.value)}
              />
            </label>
            <label className="field">
              Início - Segundos
              <input
                type="number"
                min="0"
                max="59"
                value={startSeconds}
                onChange={(event) => setStartSeconds(event.target.value)}
              />
            </label>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <label className="field">
              Fim - Minutos
              <input
                type="number"
                min="0"
                value={endMinutes}
                onChange={(event) => setEndMinutes(event.target.value)}
              />
            </label>
            <label className="field">
              Fim - Segundos
              <input
                type="number"
                min="0"
                max="59"
                value={endSeconds}
                onChange={(event) => setEndSeconds(event.target.value)}
              />
            </label>
          </div>

          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button className="primary" disabled={action.busy} onClick={handleSave}>
              Salvar
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


