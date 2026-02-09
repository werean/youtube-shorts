import type { Cut } from "../types";
import type { ActionState } from "../hooks/useAppAction";

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

interface CutsPanelProps {
  cuts: Cut[];
  action: ActionState;
  onApproveCut: (jobId: string, cutId: string) => Promise<void>;
  onRejectCut: (jobId: string, cutId: string) => Promise<void>;
  activeVideoId: string | null;
  onRunAction: <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => void;
}

export function CutsPanel({
  cuts,
  action,
  onApproveCut,
  onRejectCut,
  activeVideoId,
  onRunAction,
}: CutsPanelProps) {
  return (
    <section className="panel">
      <h2>5. Curadoria</h2>
      {cuts.length === 0 ? (
        <p className="muted">Execute a análise para ver os cortes.</p>
      ) : (
        <div className="cuts">
          {cuts.map((cut) => (
            <article key={cut.cut_id} className="cut-card">
              <header>
                <div>
                  <h3>{cut.cut_id}</h3>
                  <p>
                    {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                  </p>
                  <p className="muted">Status: {cut.status}</p>
                </div>
                {cut.score !== undefined && cut.score !== null && (
                  <div className="score">{cut.score}</div>
                )}
              </header>
              <div className="reason">
                <strong>🎣 Hook:</strong> {cut.hook_reason || "-"}
              </div>
              <div className="reason">
                <strong>📢 Conteúdo:</strong> {cut.content_reason || "-"}
              </div>
              <div className="actions">
                <button
                  className="primary"
                  disabled={action.busy}
                  onClick={() =>
                    onRunAction(
                      () => onApproveCut(activeVideoId!, cut.cut_id),
                      (value: any) => {
                        // Cut will be updated by parent
                      },
                    )
                  }
                >
                  ✓ Aprovar
                </button>
                <button
                  className="secondary"
                  disabled={action.busy}
                  onClick={() =>
                    onRunAction(
                      () => onRejectCut(activeVideoId!, cut.cut_id),
                      (value: any) => {
                        // Cut will be updated by parent
                      },
                    )
                  }
                >
                  ✗ Reprovar
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
