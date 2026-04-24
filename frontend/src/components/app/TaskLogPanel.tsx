import type { RefObject } from "react";

type TaskLogType = "transcription" | "render";

interface TaskLogPanelProps {
  taskLogsContainerRef: RefObject<HTMLDivElement>;
  activeTaskLogType: TaskLogType;
  activeTaskLogs: string[];
  expandTaskLogs: boolean;
  showTranscriptionCancel: boolean;
  showRenderCancel: boolean;
  onShowMoreTaskLogs: () => void;
  onCancelTranscription: () => void | Promise<void>;
  onCancelRendering: () => void | Promise<void>;
}

export function TaskLogPanel({
  taskLogsContainerRef,
  activeTaskLogType,
  activeTaskLogs,
  expandTaskLogs,
  showTranscriptionCancel,
  showRenderCancel,
  onShowMoreTaskLogs,
  onCancelTranscription,
  onCancelRendering,
}: TaskLogPanelProps) {
  const visibleLogs = expandTaskLogs ? activeTaskLogs : activeTaskLogs.slice(-2);

  return (
    <div className="log-container">
      <div className="log-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>
            {activeTaskLogType === "transcription"
              ? "Logs da transcrição"
              : "Logs da renderização"}
          </span>
          {showTranscriptionCancel && (
            <button
              className="cancel-button"
              onClick={() => {
                void onCancelTranscription();
              }}
            >
              ⊗ Cancelar
            </button>
          )}
          {showRenderCancel && (
            <button
              className="cancel-button"
              onClick={() => {
                void onCancelRendering();
              }}
            >
              ⊗ Cancelar
            </button>
          )}
        </div>
        {!expandTaskLogs ? (
          <button className="secondary log-toggle-button" onClick={onShowMoreTaskLogs}>
            Mostrar mais
          </button>
        ) : null}
      </div>
      <div
        ref={taskLogsContainerRef}
        className={expandTaskLogs ? "log-content expanded" : "log-content"}
      >
        {visibleLogs.length === 0
          ? "Aguardando logs..."
          : visibleLogs.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
      </div>
    </div>
  );
}
