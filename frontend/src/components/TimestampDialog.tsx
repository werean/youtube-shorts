import { useState, useEffect } from "react";
import type { Cut } from "../types";

interface TimestampDialogProps {
  mode: "add" | "edit";
  initialStartMinutes?: string;
  initialStartSeconds?: string;
  initialEndMinutes?: string;
  initialEndSeconds?: string;
  onClose: () => void;
  onSave: (startValue: number, endValue: number) => Promise<void>;
}

export function TimestampDialog({
  mode,
  initialStartMinutes = "",
  initialStartSeconds = "",
  initialEndMinutes = "",
  initialEndSeconds = "",
  onClose,
  onSave,
}: TimestampDialogProps) {
  const [startMinutes, setStartMinutes] = useState(initialStartMinutes);
  const [startSeconds, setStartSeconds] = useState(initialStartSeconds);
  const [endMinutes, setEndMinutes] = useState(initialEndMinutes);
  const [endSeconds, setEndSeconds] = useState(initialEndSeconds);
  const [error, setError] = useState("");

  useEffect(() => {
    setStartMinutes(initialStartMinutes);
    setStartSeconds(initialStartSeconds);
    setEndMinutes(initialEndMinutes);
    setEndSeconds(initialEndSeconds);
  }, [initialStartMinutes, initialStartSeconds, initialEndMinutes, initialEndSeconds]);

  const handleSave = async () => {
    const startMin = Number(startMinutes) || 0;
    const startSec = Number(startSeconds) || 0;
    const endMin = Number(endMinutes) || 0;
    const endSec = Number(endSeconds) || 0;

    if (
      !Number.isFinite(startMin) ||
      !Number.isFinite(startSec) ||
      !Number.isFinite(endMin) ||
      !Number.isFinite(endSec)
    ) {
      setError("Todos os campos devem ser números.");
      return;
    }

    if (startMin < 0 || startSec < 0 || startSec > 59 || endMin < 0 || endSec < 0 || endSec > 59) {
      setError("Minutos devem ser >= 0, segundos 0-59.");
      return;
    }

    const startValue = startMin * 60 + startSec;
    const endValue = endMin * 60 + endSec;

    if (endValue <= startValue) {
      setError("O fim precisa ser maior que o início.");
      return;
    }

    setError("");
    await onSave(startValue, endValue);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{mode === "add" ? "Adicionar Corte Manual" : "Editar timestamp"}</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          {error && (
            <div style={{ color: "red", marginBottom: "12px", fontSize: "0.9rem" }}>{error}</div>
          )}

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
                onChange={(e) => setStartMinutes(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              Início - Segundos
              <input
                type="number"
                min="0"
                max="59"
                value={startSeconds}
                onChange={(e) => setStartSeconds(e.target.value)}
                placeholder="0"
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
                onChange={(e) => setEndMinutes(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              Fim - Segundos
              <input
                type="number"
                min="0"
                max="59"
                value={endSeconds}
                onChange={(e) => setEndSeconds(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>

          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button className="primary" onClick={handleSave}>
              {mode === "add" ? "Adicionar" : "Salvar"}
            </button>
            <button className="secondary" onClick={onClose}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


