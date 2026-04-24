import { useEffect, useState } from "react";
import { AppButton, AppDialog, AppInput } from "../shared";

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
    <AppDialog
      title={mode === "add" ? "Adicionar Corte Manual" : "Editar timestamp"}
      onClose={onClose}
      showHeaderClose={false}
      footer={
        <>
          <AppButton variant="primary" onClick={onClose}>
            Cancelar
          </AppButton>
          <AppButton variant="secondary" onClick={handleSave}>
            {mode === "add" ? "Adicionar" : "Salvar"}
          </AppButton>
        </>
      }
    >
      {error ? <p className="ds-dialog-error">{error}</p> : null}

      <div className="ds-time-grid">
        <label className="field">
          Início - Minutos
          <AppInput
            type="number"
            min="0"
            value={startMinutes}
            onChange={(e) => setStartMinutes(e.target.value)}
            placeholder="0"
            fullWidth
          />
        </label>
        <label className="field">
          Início - Segundos
          <AppInput
            type="number"
            min="0"
            max="59"
            value={startSeconds}
            onChange={(e) => setStartSeconds(e.target.value)}
            placeholder="0"
            fullWidth
          />
        </label>
      </div>

      <div className="ds-time-grid">
        <label className="field">
          Fim - Minutos
          <AppInput
            type="number"
            min="0"
            value={endMinutes}
            onChange={(e) => setEndMinutes(e.target.value)}
            placeholder="0"
            fullWidth
          />
        </label>
        <label className="field">
          Fim - Segundos
          <AppInput
            type="number"
            min="0"
            max="59"
            value={endSeconds}
            onChange={(e) => setEndSeconds(e.target.value)}
            placeholder="0"
            fullWidth
          />
        </label>
      </div>
    </AppDialog>
  );
}

