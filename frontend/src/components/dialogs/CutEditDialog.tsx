import { useState } from "react";
import type { ActionState } from "../../hooks/useAppAction";
import { AppButton, AppDialog, AppInput } from "../shared";

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
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
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
      setError("Todos os campos devem ser números válidos.");
      return;
    }

    if (startMin < 0 || startSec < 0 || startSec > 59 || endMin < 0 || endSec < 0 || endSec > 59) {
      setError("Minutos devem ser ≥ 0 e segundos entre 0 e 59.");
      return;
    }

    const startValue = startMin * 60 + startSec;
    const endValue = endMin * 60 + endSec;

    if (endValue <= startValue) {
      setError("O timestamp final precisa ser maior que o inicial.");
      return;
    }

    onSave(startMin, startSec, endMin, endSec);
  };

  return (
    <AppDialog
      title="Editar timestamp do corte"
      onClose={onCancel}
      className="max-w-md"
      footer={
        <AppButton variant="secondary" disabled={action.busy} onClick={handleSave}>
          {action.busy ? "Salvando..." : "Salvar corte"}
        </AppButton>
      }
    >
      <div className="p-4 space-y-4">
        {error && (
          <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg m-0">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Ponto de Início
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Minutos</label>
              <AppInput
                type="number"
                min="0"
                value={startMinutes}
                onChange={(e) => setStartMinutes(e.target.value)}
                fullWidth
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Segundos</label>
              <AppInput
                type="number"
                min="0"
                max="59"
                value={startSeconds}
                onChange={(e) => setStartSeconds(e.target.value)}
                fullWidth
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Ponto de Fim
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Minutos</label>
              <AppInput
                type="number"
                min="0"
                value={endMinutes}
                onChange={(e) => setEndMinutes(e.target.value)}
                fullWidth
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">Segundos</label>
              <AppInput
                type="number"
                min="0"
                max="59"
                value={endSeconds}
                onChange={(e) => setEndSeconds(e.target.value)}
                fullWidth
              />
            </div>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
