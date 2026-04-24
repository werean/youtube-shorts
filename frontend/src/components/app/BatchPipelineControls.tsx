import type { BatchPipelineOptions } from "@youtube-shorts/contracts";
import { BatchPipelineDialog } from "../dialogs/BatchPipelineDialog";
import type { VideoItem } from "../../utils/videoHelpers";

interface BatchPipelineControlsProps {
  showBatchPipelineDialog: boolean;
  videos: VideoItem[];
  selectedVideosForBatch: string[];
  batchPipelineOptions: BatchPipelineOptions;
  isBatchProcessing: boolean;
  activeBatchId: string | null;
  showBatchCompletionNotification: boolean;
  batchCompletionMessage: string;
  onCloseDialog: () => void;
  onVideoToggle: (videoId: string) => void;
  onOptionChange: (changes: Partial<BatchPipelineOptions>) => void;
  onCancel: () => Promise<void>;
  onStart: () => Promise<void>;
  onCloseCompletionNotification: () => void;
}

export function BatchPipelineControls({
  showBatchPipelineDialog,
  videos,
  selectedVideosForBatch,
  batchPipelineOptions,
  isBatchProcessing,
  activeBatchId,
  showBatchCompletionNotification,
  batchCompletionMessage,
  onCloseDialog,
  onVideoToggle,
  onOptionChange,
  onCancel,
  onStart,
  onCloseCompletionNotification,
}: BatchPipelineControlsProps) {
  return (
    <>
      {showBatchPipelineDialog && (
        <BatchPipelineDialog
          videos={videos as any}
          selectedVideosForBatch={selectedVideosForBatch}
          batchPipelineOptions={batchPipelineOptions}
          isBatchProcessing={isBatchProcessing}
          activeBatchId={activeBatchId}
          onClose={onCloseDialog}
          onVideoToggle={onVideoToggle}
          onOptionChange={onOptionChange}
          onCancel={onCancel}
          onStart={onStart}
        />
      )}

      {showBatchCompletionNotification && (
        <div className="dialog-overlay" style={{ zIndex: 10000 }} onClick={(e) => e.stopPropagation()}>
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "400px" }}
          >
            <div className="dialog-header">
              <h3>Pipeline Concluído</h3>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <p style={{ whiteSpace: "pre-line", lineHeight: "1.8" }}>{batchCompletionMessage}</p>
              <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
                <button className="secondary" onClick={onCloseCompletionNotification}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
