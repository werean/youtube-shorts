import { AppButton, AppDialog } from "./shared";

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
  const hasAnyFormat = activeVideoHasText || activeVideoHasVtt || activeVideoHasSegments;

  return (
    <AppDialog
      title="Transcrição"
      onClose={onClose}
      footer={
        <>
          {activeVideoHasText ? (
            <AppButton
              variant="secondary"
              onClick={() => {
                onSelectFormat("text");
                onClose();
              }}
            >
              TXT
            </AppButton>
          ) : null}
          {activeVideoHasVtt ? (
            <AppButton
              variant="secondary"
              onClick={() => {
                onSelectFormat("vtt");
                onClose();
              }}
            >
              VTT
            </AppButton>
          ) : null}
          {activeVideoHasSegments ? (
            <AppButton
              variant="secondary"
              onClick={() => {
                onSelectFormat("segments");
                onClose();
              }}
            >
              JSON
            </AppButton>
          ) : null}
        </>
      }
    >
      <div className="ds-dialog-stack">
        <p className="muted">Escolha um formato para visualizar.</p>
        {!hasAnyFormat ? <p className="muted">Nenhum formato de transcrição disponível.</p> : null}
      </div>
    </AppDialog>
  );
}

