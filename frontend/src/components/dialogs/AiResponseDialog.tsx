import { AppDialog } from "../shared";

interface AiResponseDialogProps {
  aiResponseRaw: string;
  onClose: () => void;
}

export function AiResponseDialog({ aiResponseRaw, onClose }: AiResponseDialogProps) {
  return (
    <AppDialog title="Resposta original da IA" onClose={onClose} wide scrollable>
      <pre className="transcription-text">{aiResponseRaw}</pre>
    </AppDialog>
  );
}
