import { AppDialog } from "../shared";
import { GlassButton } from "../ui/glass";

export interface DeleteVideoConfirmDialogProps {
  videoTitle: string;
  isDeleting?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteVideoConfirmDialog({
  videoTitle,
  isDeleting = false,
  errorMessage = null,
  onCancel,
  onConfirm,
}: DeleteVideoConfirmDialogProps) {
  return (
    <AppDialog
      title="Excluir Vídeo Permanentemente"
      description="Esta ação remove todos os arquivos deste projeto do disco."
      onClose={onCancel}
      disableClose={isDeleting}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancelar
          </GlassButton>
          <GlassButton
            variant="danger"
            size="sm"
            onClick={onConfirm}
            loading={isDeleting}
            disabled={isDeleting}
            leadingIcon={
              !isDeleting ? (
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              ) : undefined
            }
          >
            {isDeleting ? "Excluindo..." : "Excluir Permanentemente"}
          </GlassButton>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
          <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold block mb-0.5">
            Vídeo selecionado
          </span>
          <p className="text-sm font-semibold text-white break-words m-0">
            {videoTitle || "Vídeo sem título"}
          </p>
        </div>

        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.08] p-3.5 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="space-y-1.5 text-xs text-rose-100/90 leading-relaxed">
            <p className="font-semibold text-rose-200 m-0">
              Atenção: esta operação não pode ser desfeita.
            </p>
            <p className="m-0 text-rose-100/85">
              Ao confirmar,{" "}
              <strong className="text-white">
                o vídeo original, dublagens/legendas, todos os cortes gerados/renderizados e tentativas arquivadas serão apagados permanentemente
              </strong>{" "}
              do computador.
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-200 leading-relaxed">
            {errorMessage}
          </div>
        )}
      </div>
    </AppDialog>
  );
}
