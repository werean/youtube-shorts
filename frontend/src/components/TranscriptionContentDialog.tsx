import type { Segment } from "../types";

interface TranscriptionContentDialogProps {
  title: string;
  content: string;
  selectedFormat: "text" | "vtt" | "segments";
  onClose: () => void;
  onDelete: (format: "text" | "vtt" | "segments") => void;
}

export function TranscriptionContentDialog({
  title,
  content,
  selectedFormat,
  onClose,
  onDelete,
}: TranscriptionContentDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>{title}</h3>
          <button className="danger" onClick={() => onDelete(selectedFormat)}>
            Deletar transcrição
          </button>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <pre className="transcription-text">{content}</pre>
        </div>
      </div>
    </div>
  );
}
