interface MoveUploadDialogProps {
  onClose: () => void;
  onConfirmMove: () => void;
  onConfirmKeep: () => void;
}

export function MoveUploadDialog({ onClose, onConfirmMove, onConfirmKeep }: MoveUploadDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Mover video para a pasta configurada?</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <p>
            Deseja mover o video selecionado para a pasta configurada para evitar uma copia extra em
            disco?
          </p>
          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button className="primary" onClick={onConfirmMove}>
              Mover e enviar
            </button>
            <button className="secondary" onClick={onConfirmKeep}>
              Manter copia
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


