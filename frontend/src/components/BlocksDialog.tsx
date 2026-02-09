interface BlocksDialogProps {
  blocks: Record<string, unknown>[];
  onClose: () => void;
}

export function BlocksDialog({ blocks, onClose }: BlocksDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Blocos Semânticos ({blocks.length})</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <div style={{ overflowY: "auto", maxHeight: "500px" }}>
            {blocks.map((block: any, index: number) => (
              <div
                key={index}
                style={{
                  marginBottom: "16px",
                  padding: "12px",
                  backgroundColor: "#f5f5f5",
                  borderRadius: "8px",
                  borderLeft: "4px solid #0066cc",
                }}
              >
                <div style={{ marginBottom: "8px" }}>
                  <strong>Bloco {index + 1}</strong>
                  {block.block_id && <span> ({block.block_id})</span>}
                </div>
                <div style={{ marginBottom: "8px", fontSize: "0.9em", color: "#666" }}>
                  {block.start?.toFixed(2)}s - {block.end?.toFixed(2)}s
                </div>
                <div style={{ lineHeight: "1.6" }}>{block.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
