interface SimpleDialogsProps {
  // Rename Video Dialog
  renameVideoId: string | null;
  renameVideoNewName: string;
  onRenameChange: (name: string) => void;
  onRenameClose: () => void;
  onRenameSave: () => void;

  // Move Upload Dialog
  showMoveUploadDialog: boolean;
  dontAskMoveUpload: boolean;
  onDontAskChange: (value: boolean) => void;
  onMoveUploadClose: () => void;
  onMoveUploadDecision: (shouldMove: boolean) => void;

  // Batch Completion Notification
  showBatchCompletionNotification: boolean;
  batchCompletionMessage: string;
  onBatchCompletionClose: () => void;
}

export function SimpleDialogs({
  renameVideoId,
  renameVideoNewName,
  onRenameChange,
  onRenameClose,
  onRenameSave,
  showMoveUploadDialog,
  dontAskMoveUpload,
  onDontAskChange,
  onMoveUploadClose,
  onMoveUploadDecision,
  showBatchCompletionNotification,
  batchCompletionMessage,
  onBatchCompletionClose,
}: SimpleDialogsProps) {
  return (
    <>
      {/* Rename Video Dialog */}
      {renameVideoId && (
        <div className="dialog-overlay" onClick={onRenameClose}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Renomear vídeo</h3>
              <div className="dialog-actions">
                <button className="icon-btn close-btn" onClick={onRenameClose}>
                  X
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <label className="field">
                Novo nome
                <input
                  type="text"
                  value={renameVideoNewName}
                  onChange={(e) => onRenameChange(e.target.value)}
                  placeholder="Nome do vídeo"
                />
              </label>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button className="secondary" onClick={onRenameSave}>
                  Salvar
                </button>
                <button className="primary" onClick={onRenameClose}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Upload Dialog */}
      {showMoveUploadDialog && (
        <div className="dialog-overlay" onClick={onMoveUploadClose}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Mover video para a pasta configurada?</h3>
              <div className="dialog-actions">
                <button className="icon-btn close-btn" onClick={onMoveUploadClose}>
                  X
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <p>
                Deseja mover o video selecionado para a pasta configurada para evitar uma copia
                extra em disco?
              </p>
              <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={dontAskMoveUpload}
                  onChange={(e) => onDontAskChange(e.target.checked)}
                />
                <span>Nao perguntar novamente</span>
              </label>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button className="secondary" onClick={() => onMoveUploadDecision(true)}>
                  Mover e enviar
                </button>
                <button className="primary" onClick={() => onMoveUploadDecision(false)}>
                  Manter copia
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Completion Notification */}
      {showBatchCompletionNotification && (
        <div
          className="dialog-overlay"
          style={{ zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "400px" }}
          >
            <div className="dialog-header">
              <h3>Pipeline Concluído</h3>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <p style={{ whiteSpace: "pre-line", lineHeight: "1.8" }}>{batchCompletionMessage}</p>
              <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
                <button
                  className="secondary"
                  onClick={onBatchCompletionClose}
                  style={{
                    padding: "10px 30px",
                    borderRadius: "8px",
                    fontSize: "16px",
                    fontWeight: "600",
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

