import { useState } from "react";
import type { Cut } from "../../types";
import type { ActionState } from "../../hooks/useAppAction";
import { AppButton, AppDialog } from "../shared";

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface RegenerateAnalyzeDialogProps {
  suggestedCuts: Cut[];
  action: ActionState;
  onMaintainSelected: (keptCutIds: string[]) => void;
  onRegenerateAll: () => void;
  onCancel: () => void;
}

export function RegenerateAnalyzeDialog({
  suggestedCuts,
  action,
  onMaintainSelected,
  onRegenerateAll,
  onCancel,
}: RegenerateAnalyzeDialogProps) {
  const [keepCutIds, setKeepCutIds] = useState<string[]>([]);

  return (
    <AppDialog
      title="Gerar nova análise"
      onClose={onCancel}
      footer={
        <>
          <AppButton variant="secondary" disabled={action.busy} onClick={onRegenerateAll}>
            Apagar cortes e gerar novos cortes
          </AppButton>
          <AppButton
            variant="secondary"
            disabled={keepCutIds.length === 0 || action.busy}
            onClick={() => onMaintainSelected(keepCutIds)}
          >
            {action.busy ? "Analisando..." : "Manter os cortes selecionados e gerar novos"}
          </AppButton>
        </>
      }
    >
      <div className="ds-dialog-stack">
        <p className="muted">Selecione os cortes que deseja manter:</p>
        <div className="ds-cut-checkbox-list">
          {suggestedCuts.map((cut) => (
            <label key={cut.cut_id} className="ds-cut-checkbox-item">
              <input
                type="checkbox"
                checked={keepCutIds.includes(cut.cut_id)}
                onChange={(event) => {
                  if (event.target.checked) {
                    setKeepCutIds((current) => [...current, cut.cut_id]);
                  } else {
                    setKeepCutIds((current) => current.filter((item) => item !== cut.cut_id));
                  }
                }}
              />
              <span>
                {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
              </span>
            </label>
          ))}
        </div>
      </div>
    </AppDialog>
  );
}

