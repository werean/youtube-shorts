import { AppDialog } from "../shared";
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
        <AppDialog
          title="Renomear Vídeo"
          description="Altere o título de identificação deste arquivo na biblioteca."
          onClose={onRenameClose}
          size="sm"
          footer={
            <div className="flex items-center justify-end w-full">
              <GlassButton variant="primary" size="sm" onClick={onRenameSave}>
                Salvar
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">
              Novo Nome do Vídeo
            </label>
            <input
              type="text"
              value={renameVideoNewName}
              onChange={(e) => onRenameChange(e.target.value)}
              placeholder="Digite o novo nome..."
              autoFocus
              className="w-full h-9 px-3 text-xs bg-black/40 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all font-sans"
            />
          </div>
        </AppDialog>
      )}

      {/* Move Upload Dialog */}
      {showMoveUploadDialog && (
        <AppDialog
          title="Mover Vídeo para a Pasta Configurada?"
          description="Evite cópias duplicadas movendo o arquivo diretamente para a estrutura do ClipFlow."
          onClose={onMoveUploadClose}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <GlassButton variant="ghost" size="sm" onClick={() => onMoveUploadDecision(false)}>
                Manter Cópia
              </GlassButton>
              <GlassButton variant="primary" size="sm" onClick={() => onMoveUploadDecision(true)}>
                Mover e Enviar
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-300 leading-relaxed">
              Deseja mover o vídeo selecionado para a pasta configurada da aplicação para economizar espaço em disco e acelerar o processamento?
            </p>
            <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs text-zinc-400 p-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] transition-all">
              <input
                type="checkbox"
                checked={dontAskMoveUpload}
                onChange={(e) => onDontAskChange(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-white/10 text-white focus:ring-0 cursor-pointer"
              />
              <span>Não perguntar novamente (lembrar preferência)</span>
            </label>
          </div>
        </AppDialog>
      )}

      {/* Batch Completion Notification */}
      {showBatchCompletionNotification && (
        <AppDialog
          title="Processamento em Lote Concluído"
          description="Todos os vídeos agendados na fila de processamento foram finalizados."
          onClose={onBatchCompletionClose}
          size="sm"
          footer={
            <div className="flex justify-end w-full">
              <GlassButton
                variant="primary"
                onClick={onBatchCompletionClose}
              >
                Concluir
              </GlassButton>
            </div>
          }
        >
          <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-line p-2 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            {batchCompletionMessage}
          </p>
        </AppDialog>
      )}
    </>
  );
}
