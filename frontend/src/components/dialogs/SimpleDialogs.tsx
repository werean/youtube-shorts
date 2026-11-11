import { GlassButton } from "../ui/glass";

interface SimpleDialogsProps {
  // Rename Video Dialog
  renameVideoId: string | null;
  renameVideoNewName: string;
  onRenameChange: (name: string) => void;
  onRenameClose: () => void;
  onRenameSave: () => void;

  // Move Upload Dialog
  showMoveUploadDialog: boolean;
  dontAskMoveUpload: boolean;
  onDontAskChange: (value: boolean) => void;
  onMoveUploadClose: () => void;
  onMoveUploadDecision: (shouldMove: boolean) => void;

  // Batch Completion Notification
  showBatchCompletionNotification: boolean;
  batchCompletionMessage: string;
  onBatchCompletionClose: () => void;
}

export function SimpleDialogs({
  renameVideoId,
  renameVideoNewName,
  onRenameChange,
  onRenameClose,
  onRenameSave,
  showMoveUploadDialog,
  dontAskMoveUpload,
  onDontAskChange,
  onMoveUploadClose,
  onMoveUploadDecision,
  showBatchCompletionNotification,
  batchCompletionMessage,
  onBatchCompletionClose,
}: SimpleDialogsProps) {
  return (
    <>
      {/* Rename Video Dialog */}
      {renameVideoId && (
        <div className="dialog-overlay" onClick={onRenameClose}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3 className="text-sm font-semibold text-white">Renomear Vídeo</h3>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="icon-btn close-btn"
                  onClick={onRenameClose}
                  aria-label="Fechar"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="dialog-content space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Novo Nome
                </label>
                <input
                  type="text"
                  value={renameVideoNewName}
                  onChange={(e) => onRenameChange(e.target.value)}
                  placeholder="Nome do vídeo"
                  className="w-full h-9 px-3 text-xs bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all font-sans"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                <GlassButton variant="ghost" size="sm" onClick={onRenameClose}>
                  Cancelar
                </GlassButton>
                <GlassButton variant="primary" size="sm" onClick={onRenameSave}>
                  Salvar
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Upload Dialog */}
      {showMoveUploadDialog && (
        <div className="dialog-overlay" onClick={onMoveUploadClose}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3 className="text-sm font-semibold text-white">Mover Vídeo para a Pasta Configurada?</h3>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="icon-btn close-btn"
                  onClick={onMoveUploadClose}
                  aria-label="Fechar"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="dialog-content space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Deseja mover o vídeo selecionado para a pasta configurada da aplicação para evitar uma cópia extra em disco?
              </p>
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={dontAskMoveUpload}
                  onChange={(e) => onDontAskChange(e.target.checked)}
                  className="rounded border-white/20 bg-white/10 text-white focus:ring-0"
                />
                <span>Não perguntar novamente</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
                <GlassButton variant="ghost" size="sm" onClick={() => onMoveUploadDecision(false)}>
                  Manter Cópia
                </GlassButton>
                <GlassButton variant="primary" size="sm" onClick={() => onMoveUploadDecision(true)}>
                  Mover e Enviar
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Completion Notification */}
      {showBatchCompletionNotification && (
        <div
          className="dialog-overlay"
          style={{ zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "420px" }}
          >
            <div className="dialog-header">
              <h3 className="text-sm font-semibold text-white">Processamento em Lote Concluído</h3>
            </div>
            <div className="dialog-content space-y-4 p-5">
              <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-line">
                {batchCompletionMessage}
              </p>
              <div className="flex justify-end pt-2 border-t border-white/[0.08]">
                <GlassButton
                  variant="primary"
                  onClick={onBatchCompletionClose}
                >
                  OK
                </GlassButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
