import { AppDialog } from "../shared";

interface BlocksDialogProps {
  blocks: Record<string, unknown>[];
  onClose: () => void;
}

export function BlocksDialog({ blocks, onClose }: BlocksDialogProps) {
  return (
    <AppDialog title={`Blocos Semânticos (${blocks.length})`} onClose={onClose} wide scrollable>
      <div className="ds-dialog-scroll-list">
        {blocks.map((block: any, index: number) => (
          <article key={index} className="ds-dialog-block-card">
            <div className="ds-dialog-block-title">
              <strong>Bloco {index + 1}</strong>
              {block.block_id ? <span> ({block.block_id})</span> : null}
            </div>
            <p className="ds-dialog-block-range">
              {block.start?.toFixed(2)}s - {block.end?.toFixed(2)}s
            </p>
            <div className="ds-dialog-block-text">{String(block.text || "")}</div>
          </article>
        ))}
      </div>
    </AppDialog>
  );
}
