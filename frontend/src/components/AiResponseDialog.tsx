interface AiResponseDialogProps {
  aiResponseRaw: string;
  onClose: () => void;
}

export function AiResponseDialog({ aiResponseRaw, onClose }: AiResponseDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Resposta original da IA</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <pre className="transcription-text">{aiResponseRaw}</pre>
        </div>
      </div>
    </div>
  );
}


