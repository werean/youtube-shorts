import { useState } from "react";
import { AppButton, AppDialog } from "./shared";

interface TranscriptionFormatListDialogProps {
  activeVideoHasText: boolean;
  activeVideoHasVtt: boolean;
  activeVideoHasSegments: boolean;
  deletingTranscription: boolean;
  onSelectFormat: (format: "text" | "vtt" | "segments") => void;
  onDeleteAll: () => void;
  onClose: () => void;
}

export function TranscriptionFormatListDialog({
  activeVideoHasText,
  activeVideoHasVtt,
  activeVideoHasSegments,
  deletingTranscription,
  onSelectFormat,
  onDeleteAll,
  onClose,
}: TranscriptionFormatListDialogProps) {
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const hasAnyFormat = activeVideoHasText || activeVideoHasVtt || activeVideoHasSegments;

  return (
    <>
      <AppDialog
        title="Transcrição"
        onClose={onClose}
        footer={
          <>
            <AppButton variant="primary" onClick={onClose} disabled={deletingTranscription}>
              Fechar
            </AppButton>
            {hasAnyFormat ? (
              <AppButton
                variant="default"
                className="danger primary"
                onClick={() => setShowDeleteConfirmDialog(true)}
                disabled={deletingTranscription}
              >
                {deletingTranscription ? "Apagando..." : "Apagar transcrição"}
              </AppButton>
            ) : null}
          </>
        }
      >
        <div className="ds-dialog-stack">
          <p className="muted">Escolha um formato para visualizar.</p>
          {hasAnyFormat ? (
            <div className="ds-dialog-actions ds-dialog-actions--start">
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
            </div>
          ) : null}
          {!hasAnyFormat ? (
            <p className="muted">Nenhum formato de transcrição disponível.</p>
          ) : null}
        </div>
      </AppDialog>

      {showDeleteConfirmDialog ? (
        <AppDialog
          title="Confirmar exclusão"
          onClose={() => setShowDeleteConfirmDialog(false)}
          showHeaderClose={false}
          footer={
            <>
              <AppButton
                variant="primary"
                onClick={() => setShowDeleteConfirmDialog(false)}
                disabled={deletingTranscription}
              >
                Não
              </AppButton>
              <AppButton
                variant="secondary"
                onClick={() => {
                  onDeleteAll();
                  setShowDeleteConfirmDialog(false);
                }}
                disabled={deletingTranscription}
              >
                Sim
              </AppButton>
            </>
          }
        >
          <p>Tem certeza que deseja apagar essa transcrição?</p>
        </AppDialog>
      ) : null}
    </>
  );
}
