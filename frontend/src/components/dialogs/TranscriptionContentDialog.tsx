import { AppButton, AppDialog } from "../shared";

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
    <AppDialog
      title={title}
      onClose={onClose}
      wide
      scrollable
      footer={
        <AppButton variant="default" className="danger" onClick={() => onDelete(selectedFormat)}>
          Deletar transcrição
        </AppButton>
      }
    >
      <div className="p-4">
        <pre className="transcription-text font-mono text-xs bg-black/60 p-4 rounded-xl border border-white/10 text-zinc-300 overflow-x-auto m-0 max-h-[60vh] overscroll-contain">
          {content}
        </pre>
      </div>
    </AppDialog>
  );
}
