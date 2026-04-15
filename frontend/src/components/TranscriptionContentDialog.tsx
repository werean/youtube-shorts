import { AppButton, AppDialog } from "./shared";

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
      showHeaderClose={false}
      wide
      scrollable
      footer={
        <>
          <AppButton variant="default" className="danger" onClick={() => onDelete(selectedFormat)}>
            Deletar transcrição
          </AppButton>
          <AppButton variant="primary" onClick={onClose}>
            Fechar
          </AppButton>
        </>
      }
    >
      <pre className="transcription-text">{content}</pre>
    </AppDialog>
  );
}

