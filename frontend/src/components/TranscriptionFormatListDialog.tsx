interface TranscriptionFormatListDialogProps {
  activeVideoHasText: boolean;
  activeVideoHasVtt: boolean;
  activeVideoHasSegments: boolean;
  onSelectFormat: (format: "text" | "vtt" | "segments") => void;
  onClose: () => void;
}

export function TranscriptionFormatListDialog({
  activeVideoHasText,
  activeVideoHasVtt,
  activeVideoHasSegments,
  onSelectFormat,
  onClose,
}: TranscriptionFormatListDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Transcrição</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <p>Escolha um formato para visualizar:</p>
          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            {activeVideoHasText && (
              <button
                className="secondary"
                onClick={() => {
                  onSelectFormat("text");
                  onClose();
                }}
              >
                TXT
              </button>
            )}
            {activeVideoHasVtt && (
              <button
                className="secondary"
                onClick={() => {
                  onSelectFormat("vtt");
                  onClose();
                }}
              >
                VTT
              </button>
            )}
            {activeVideoHasSegments && (
              <button
                className="secondary"
                onClick={() => {
                  onSelectFormat("segments");
                  onClose();
                }}
              >
                JSON
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


