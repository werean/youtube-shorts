import { useState } from "react";
import { AppButton, AppDialog } from "../shared";

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
        className="max-w-md"
        footer={
          hasAnyFormat ? (
            <AppButton
              variant="default"
              className="danger"
              onClick={() => setShowDeleteConfirmDialog(true)}
              disabled={deletingTranscription}
            >
              {deletingTranscription ? "Apagando..." : "Apagar transcrição completa"}
            </AppButton>
          ) : undefined
        }
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-zinc-400 m-0">
            Escolha o formato da transcrição que deseja visualizar ou exportar:
          </p>
          {hasAnyFormat ? (
            <div className="grid grid-cols-3 gap-2.5">
              {activeVideoHasText ? (
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    onSelectFormat("text");
                    onClose();
                  }}
                  className="w-full text-center py-3"
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
                  className="w-full text-center py-3"
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
                  className="w-full text-center py-3"
                >
                  JSON
                </AppButton>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 m-0">Nenhum formato de transcrição disponível para este vídeo.</p>
          )}
        </div>
      </AppDialog>

      {showDeleteConfirmDialog ? (
        <AppDialog
          title="Confirmar exclusão de transcrição"
          onClose={() => setShowDeleteConfirmDialog(false)}
          className="max-w-md"
          footer={
            <AppButton
              variant="default"
              className="danger"
              onClick={() => {
                onDeleteAll();
                setShowDeleteConfirmDialog(false);
              }}
              disabled={deletingTranscription}
            >
              {deletingTranscription ? "Apagando..." : "Sim, confirmar exclusão"}
            </AppButton>
          }
        >
          <div className="p-4 space-y-2">
            <p className="text-sm text-zinc-300 m-0 leading-relaxed">
              Tem certeza que deseja apagar todos os arquivos desta transcrição?
            </p>
            <p className="text-xs text-zinc-400 m-0">
              O status do vídeo retornará para DOWNLOADED.
            </p>
          </div>
        </AppDialog>
      ) : null}
    </>
  );
}
