import { useState } from "react";
import { selectFolder } from "../../api";
import type { ActionState } from "../../hooks/useAppAction";
import { AppDialog } from "../shared";
import { GlassButton, GlassCard, GlassBadge } from "../ui/glass";

interface ConfigureAppDialogProps {
  configBaseDir: string;
  configDownloadResolution: string;
  appSettings: any;
  action: ActionState;
  onSave: (
    baseDir: string,
    resolution: "1080p" | "1440p" | "4k",
    askDeleteCutConfirm: boolean,
  ) => void;
  onCancel: () => void;
}

export function ConfigureAppDialog({
  configBaseDir: initialDir,
  configDownloadResolution: initialResolution,
  appSettings,
  action,
  onSave,
  onCancel,
}: ConfigureAppDialogProps) {
  const [baseDir, setBaseDir] = useState(initialDir);
  const [resolution, setResolution] = useState<"1080p" | "1440p" | "4k">(
    initialResolution as "1080p" | "1440p" | "4k",
  );
  const [askDeleteCutConfirm, setAskDeleteCutConfirm] = useState<boolean>(
    appSettings?.preferences?.ask_delete_cut_confirm ?? true,
  );

  const handlePickFolder = async () => {
    try {
      const result = await selectFolder();
      if (result.selected && result.path) {
        setBaseDir(result.path);
      }
    } catch (error) {
      console.error("Erro ao abrir seletor de pasta:", error);
    }
  };

  const handleSave = () => {
    if (baseDir.trim()) {
      onSave(baseDir, resolution, askDeleteCutConfirm);
    }
  };

  return (
    <AppDialog
      title="Configurações da Aplicação"
      onClose={onCancel}
      showHeaderClose={true}
      wide
      scrollable
      footer={
        <div className="flex items-center justify-end w-full">
          <GlassButton
            variant="primary"
            disabled={action.busy || !baseDir.trim()}
            loading={action.busy}
            onClick={handleSave}
            leadingIcon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            }
          >
            Salvar Configurações
          </GlassButton>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Card: Diretorio de Armazenamento */}
        <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 flex-shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Diretório de Armazenamento</h4>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Onde os arquivos de vídeo, cortes renderizados e transcrições serão salvos.
                </p>
              </div>
            </div>

            <GlassButton
              variant="glass"
              size="sm"
              onClick={handlePickFolder}
              leadingIcon={
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              }
            >
              Selecionar Pasta
            </GlassButton>
          </div>

          <div className="space-y-2 pt-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Caminho no Computador
            </label>
            <input
              type="text"
              value={baseDir}
              onChange={(e) => setBaseDir(e.target.value)}
              placeholder="Ex: /home/usuario/Videos/YouTubeShorts"
              className="w-full h-10 px-3.5 text-sm font-sans bg-black/40 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all"
            />
            <div className="space-y-1 pt-1">
              <span className="text-xs font-medium text-zinc-400">Caminho ativo no sistema:</span>
              <p className="text-xs text-zinc-200 font-sans bg-black/40 p-2.5 rounded-xl border border-white/[0.08] break-all select-all leading-relaxed m-0">
                {appSettings?.media.base_dir || baseDir}
              </p>
            </div>
          </div>

          {/* Estrutura de Pastas Preview */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Estrutura Criada Automaticamente
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-0.5 font-sans font-medium text-xs">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-zinc-200">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span>/videos/</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-zinc-200">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>/shorts/</span>
              </div>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-zinc-200">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span>/transcrições/</span>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Card: Resolução de Download */}
        <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300 flex-shrink-0">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Resolução de Download</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Resolução padrão usada pelo pipeline yt-dlp ao baixar conteúdos do YouTube.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {[
              { id: "1080p", label: "1080p Full HD", badge: "Padrão" },
              { id: "1440p", label: "1440p 2K", badge: "Alta Fidelidade" },
              { id: "4k", label: "4K Ultra HD", badge: "Máxima" },
            ].map((item) => {
              const isSelected = resolution === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setResolution(item.id as "1080p" | "1440p" | "4k")}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all duration-200 ${
                    isSelected
                      ? "bg-white/[0.1] border-white/30 shadow-[0_2px_12px_rgba(255,255,255,0.1),inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                      : "bg-white/[0.02] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-semibold text-white">{item.label}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSelected ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" : "bg-zinc-700"
                      }`}
                    />
                  </div>
                  <span className="text-xs text-zinc-400 mt-1 font-sans font-medium">{item.badge}</span>
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* Card: Preferências do Usuário */}
        <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h4 className="text-sm font-semibold text-white">Confirmação ao Excluir Cortes</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Exibir diálogo de confirmação antes de apagar um corte gerado ou editado.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAskDeleteCutConfirm((prev) => !prev)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 focus:outline-none flex-shrink-0 ${
                askDeleteCutConfirm ? "bg-white justify-end" : "bg-zinc-800 justify-start"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full shadow-md transition-all duration-200 ${
                  askDeleteCutConfirm ? "bg-zinc-950" : "bg-zinc-400"
                }`}
              />
            </button>
          </div>
        </GlassCard>
      </div>
    </AppDialog>
  );
}
