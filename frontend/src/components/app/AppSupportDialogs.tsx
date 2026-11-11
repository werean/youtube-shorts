import { AppDialog } from "../shared";
import { GlassButton, GlassCard } from "../ui/glass";

interface AppSupportDialogsProps {
  showTranscriptionRegenerateConfirmDialog: boolean;
  showDeleteCutConfirmDialog: boolean;
  showHowToUseDialog: boolean;
  dontAskDeleteCutAgain: boolean;
  onCloseTranscriptionRegenerateConfirm: () => void;
  onConfirmTranscriptionRegenerate: () => void;
  onCloseDeleteCutConfirm: () => void;
  onConfirmDeleteCut: () => void;
  onDontAskDeleteCutAgainChange: (value: boolean) => void;
  onCloseHowToUse: () => void;
}

export function AppSupportDialogs({
  showTranscriptionRegenerateConfirmDialog,
  showDeleteCutConfirmDialog,
  showHowToUseDialog,
  dontAskDeleteCutAgain,
  onCloseTranscriptionRegenerateConfirm,
  onConfirmTranscriptionRegenerate,
  onCloseDeleteCutConfirm,
  onConfirmDeleteCut,
  onDontAskDeleteCutAgainChange,
  onCloseHowToUse,
}: AppSupportDialogsProps) {
  return (
    <>
      {showTranscriptionRegenerateConfirmDialog && (
        <AppDialog
          title="Confirmar Nova Transcrição"
          onClose={onCloseTranscriptionRegenerateConfirm}
          showHeaderClose={true}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <GlassButton variant="ghost" onClick={onCloseTranscriptionRegenerateConfirm}>
                Cancelar
              </GlassButton>
              <GlassButton variant="primary" onClick={onConfirmTranscriptionRegenerate}>
                Substituir Transcrição
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-3 py-2">
            <p className="text-xs text-zinc-200 leading-relaxed">
              Esta ação executará novamente o Whisper no arquivo fonte e substituirá todos os segmentos de áudio e cortes atuais vinculados a este vídeo.
            </p>
            <p className="text-[11px] text-zinc-400">
              Deseja realmente continuar?
            </p>
          </div>
        </AppDialog>
      )}

      {showDeleteCutConfirmDialog && (
        <AppDialog
          title="Excluir Corte"
          onClose={onCloseDeleteCutConfirm}
          showHeaderClose={true}
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <GlassButton variant="ghost" onClick={onCloseDeleteCutConfirm}>
                Cancelar
              </GlassButton>
              <GlassButton variant="danger" onClick={onConfirmDeleteCut}>
                Excluir Corte
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-4 py-2">
            <p className="text-xs text-zinc-200 leading-relaxed">
              Tem certeza que deseja apagar este corte? Ele será removido da lista de sugestões.
            </p>
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={dontAskDeleteCutAgain}
                onChange={(e) => onDontAskDeleteCutAgainChange(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-white focus:ring-0"
              />
              <span>Não exibir esta confirmação novamente</span>
            </label>
          </div>
        </AppDialog>
      )}

      {showHowToUseDialog && (
        <AppDialog
          title="Guia do ClipFlow Studio"
          onClose={onCloseHowToUse}
          showHeaderClose={true}
          wide
          scrollable
          footer={
            <div className="flex justify-end w-full">
              <GlassButton variant="primary" onClick={onCloseHowToUse}>
                Entendi, Fechar
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-4 py-1">
            <p className="text-xs text-zinc-300 leading-relaxed">
              O ClipFlow Studio transforma gravações longas em Shorts verticais de alta retenção através de inteligência artificial local. Siga o fluxo passo a passo:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  step: "01",
                  title: "Ambiente & Dependências",
                  desc: "Abra 'Gerenciar Dependências' no menu de configurações e confirme que Python, Whisper, FFmpeg e Ollama estão operacionais.",
                },
                {
                  step: "02",
                  title: "Modelos de IA (LLM)",
                  desc: "Em 'Configurar LLM', escolha um modelo ativo no Ollama para realizar a triagem semântica dos melhores momentos.",
                },
                {
                  step: "03",
                  title: "Importação de Mídia",
                  desc: "Cole uma URL do YouTube ou arraste um arquivo MP4/MOV local na barra lateral de Biblioteca.",
                },
                {
                  step: "04",
                  title: "Transcrição com Whisper",
                  desc: "Gere a transcrição sincronizada. Cada frase terá timestamp navegável na coluna central.",
                },
                {
                  step: "05",
                  title: "Análise Semântica por IA",
                  desc: "A inteligência artificial analisa os blocos de assunto e identifica ganchos virais e momentos de clímax.",
                },
                {
                  step: "06",
                  title: "Inspeção 9:16 & Ajuste Fino",
                  desc: "No Inspetor à direita, visualize o corte no simulador vertical, ajuste início e fim em [-1s] e [+1s] e renderize em 1080x1920.",
                },
              ].map((item) => (
                <GlassCard key={item.step} className="p-3.5 border-white/10 bg-white/[0.02] space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white border border-white/10">
                      {item.step}
                    </span>
                    <h4 className="text-xs font-semibold text-white">{item.title}</h4>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{item.desc}</p>
                </GlassCard>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2.5">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>
                <strong>Dica Pro:</strong> Após validar o resultado em um vídeo, use a aba <strong>Fila de Render</strong> para processar lotes inteiros de vídeos simultaneamente.
              </span>
            </div>
          </div>
        </AppDialog>
      )}
    </>
  );
}
