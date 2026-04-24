import { TranscriptionContentDialog } from "../dialogs/TranscriptionContentDialog";
import { TranscriptionDeleteDialog } from "../dialogs/TranscriptionDeleteDialog";
import { TranscriptionFormatListDialog } from "../dialogs/TranscriptionFormatListDialog";

type TranscriptionFormat = "text" | "vtt" | "segments";

interface ActionState {
  busy: boolean;
  error?: string;
}

interface TranscriptionContent {
  title: string;
  content: string;
}

interface TranscriptionDialogsProps {
  showTranscriptionFormatListDialog: boolean;
  showTranscriptionContentDialog: boolean;
  showTranscriptionDeleteDialog: boolean;
  hasActiveVideo: boolean;
  activeVideoHasText: boolean;
  activeVideoHasVtt: boolean;
  activeVideoHasSegments: boolean;
  deletingTranscription: boolean;
  transcriptionContent: TranscriptionContent | null;
  selectedTranscriptionFormat: TranscriptionFormat | null;
  pendingDeleteFormat: TranscriptionFormat | null;
  action: ActionState;
  onSelectFormat: (format: TranscriptionFormat) => void;
  onDeleteAll: () => void;
  onCloseFormatList: () => void;
  onCloseContent: () => void;
  onRequestDeleteFormat: (format: TranscriptionFormat) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (format: TranscriptionFormat) => void;
}

export function TranscriptionDialogs({
  showTranscriptionFormatListDialog,
  showTranscriptionContentDialog,
  showTranscriptionDeleteDialog,
  hasActiveVideo,
  activeVideoHasText,
  activeVideoHasVtt,
  activeVideoHasSegments,
  deletingTranscription,
  transcriptionContent,
  selectedTranscriptionFormat,
  pendingDeleteFormat,
  action,
  onSelectFormat,
  onDeleteAll,
  onCloseFormatList,
  onCloseContent,
  onRequestDeleteFormat,
  onCancelDelete,
  onConfirmDelete,
}: TranscriptionDialogsProps) {
  return (
    <>
      {showTranscriptionFormatListDialog && hasActiveVideo && (
        <TranscriptionFormatListDialog
          activeVideoHasText={activeVideoHasText}
          activeVideoHasVtt={activeVideoHasVtt}
          activeVideoHasSegments={activeVideoHasSegments}
          deletingTranscription={deletingTranscription}
          onSelectFormat={onSelectFormat}
          onDeleteAll={onDeleteAll}
          onClose={onCloseFormatList}
        />
      )}

      {showTranscriptionContentDialog && transcriptionContent && (
        <TranscriptionContentDialog
          title={transcriptionContent.title}
          content={transcriptionContent.content}
          selectedFormat={selectedTranscriptionFormat || "text"}
          onClose={onCloseContent}
          onDelete={onRequestDeleteFormat}
        />
      )}

      {showTranscriptionDeleteDialog && pendingDeleteFormat && hasActiveVideo && (
        <TranscriptionDeleteDialog
          pendingDeleteFormat={pendingDeleteFormat}
          action={action}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}
    </>
  );
}
