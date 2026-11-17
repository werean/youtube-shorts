import { useState } from "react";
import type {
  DubbingEngine,
  DubbingLanguage,
  DubbingSettings,
  DubbingSubtitlePreset,
  DubbingVoiceMode,
} from "@youtube-shorts/contracts";
import { selectFolder } from "../../api";
import type { ActionState } from "../../hooks/useAppAction";
import { AppDialog } from "../shared";
import { GlassButton, GlassCard } from "../ui/glass";

interface ConfigureAppDialogProps {
  configBaseDir: string;
  configDownloadResolution: string;
  appSettings: any;
  action: ActionState;
  onSave: (
    baseDir: string,
    resolution: "1080p" | "1440p" | "4k",
    askDeleteCutConfirm: boolean,
    dubbingSettings?: DubbingSettings,
  ) => void;
  onCancel: () => void;
}

const DEFAULT_DUBBING_SETTINGS: DubbingSettings = {
  engine: "qwen3_tts",
  default_target_lang: "ask",
  default_voice_mode: "auto",
  default_subtitles_enabled: true,
  default_subtitle_preset: "mov_text",
};

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
  const initialDubbing: DubbingSettings = {
    engine:
      appSettings?.dubbing?.engine === "chatterbox" ? "chatterbox" : DEFAULT_DUBBING_SETTINGS.engine,
    default_target_lang:
      appSettings?.dubbing?.default_target_lang || DEFAULT_DUBBING_SETTINGS.default_target_lang,
    default_voice_mode:
      appSettings?.dubbing?.default_voice_mode === "single"
        ? "single"
        : DEFAULT_DUBBING_SETTINGS.default_voice_mode,
    default_subtitles_enabled:
      typeof appSettings?.dubbing?.default_subtitles_enabled === "boolean"
        ? appSettings.dubbing.default_subtitles_enabled
        : DEFAULT_DUBBING_SETTINGS.default_subtitles_enabled,
    default_subtitle_preset:
      appSettings?.dubbing?.default_subtitle_preset === "hardsub"
        ? "hardsub"
        : DEFAULT_DUBBING_SETTINGS.default_subtitle_preset,
  };
  const [dubbingEngine, setDubbingEngine] = useState<DubbingEngine>(initialDubbing.engine);
  const [dubbingDefaultLang, setDubbingDefaultLang] = useState<"ask" | DubbingLanguage>(
    initialDubbing.default_target_lang,
  );
  const [dubbingVoiceMode, setDubbingVoiceMode] = useState<DubbingVoiceMode>(
    initialDubbing.default_voice_mode,
  );
  const [dubbingSubtitlesEnabled, setDubbingSubtitlesEnabled] = useState<boolean>(
    initialDubbing.default_subtitles_enabled,
  );
  const [dubbingSubtitlePreset, setDubbingSubtitlePreset] = useState<DubbingSubtitlePreset>(
    initialDubbing.default_subtitle_preset,
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
      onSave(baseDir, resolution, askDeleteCutConfirm, {
        engine: dubbingEngine,
        default_target_lang: dubbingDefaultLang,
        default_voice_mode: dubbingVoiceMode,
        default_subtitles_enabled: dubbingSubtitlesEnabled,
        default_subtitle_preset: dubbingSubtitlePreset,
      });
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

        {/* Card: Dublagem & Legendas (IA Local) */}
        <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-400/25 flex items-center justify-center text-cyan-300 flex-shrink-0">
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 8l6 6" />
                <path d="M4 14l6-6 2-3" />
                <path d="M2 5h12" />
                <path d="M7 2h1" />
                <path d="M22 22l-5-10-5 10" />
                <path d="M14 18h6" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Dublagem &amp; Legendas (IA Local)</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Configure o motor neural de clonagem de voz, idioma padrão e formato de exportação das legendas.
              </p>
            </div>
          </div>

          {/* Motor de Síntese Vocal */}
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
              Motor TTS Local
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                {
                  id: "qwen3_tts" as DubbingEngine,
                  label: "Qwen3-TTS-1.7B",
                  desc: "Clonagem prosódica multilíngue padrão (alta fidelidade)",
                },
                {
                  id: "chatterbox" as DubbingEngine,
                  label: "Chatterbox Multilingual",
                  desc: "Alternativa expressiva com controle emocional local",
                },
              ].map((item) => {
                const isSelected = dubbingEngine === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDubbingEngine(item.id)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all duration-200 ${
                      isSelected
                        ? "bg-white/[0.1] border-cyan-400/45 shadow-[0_2px_12px_rgba(34,211,238,0.12),inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                        : "bg-white/[0.02] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-sm font-semibold text-white">{item.label}</span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSelected ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" : "bg-zinc-700"
                        }`}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-1 leading-snug">{item.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Idioma Padrão e Modo de Vozes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
                Idioma de Destino Padrão
              </span>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "ask" as const, label: "Perguntar sempre" },
                  { id: "pt-BR" as DubbingLanguage, label: "PT-BR" },
                  { id: "en" as DubbingLanguage, label: "EN" },
                  { id: "es" as DubbingLanguage, label: "ES" },
                ].map((langOpt) => {
                  const isSelected = dubbingDefaultLang === langOpt.id;
                  return (
                    <button
                      key={langOpt.id}
                      type="button"
                      onClick={() => setDubbingDefaultLang(langOpt.id)}
                      className={`px-3 py-2 rounded-xl border text-xs font-medium text-left transition-all ${
                        isSelected
                          ? "bg-white/[0.12] border-white/35 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                          : "bg-white/[0.02] border-white/[0.08] text-zinc-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {langOpt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
                Modo de Vozes
              </span>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { id: "auto" as DubbingVoiceMode, label: "Automático (detectar pessoas)" },
                  { id: "single" as DubbingVoiceMode, label: "Voz única" },
                ].map((modeOpt) => {
                  const isSelected = dubbingVoiceMode === modeOpt.id;
                  return (
                    <button
                      key={modeOpt.id}
                      type="button"
                      onClick={() => setDubbingVoiceMode(modeOpt.id)}
                      className={`px-3 py-2 rounded-xl border text-xs font-medium text-left flex items-center justify-between transition-all ${
                        isSelected
                          ? "bg-white/[0.12] border-white/35 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                          : "bg-white/[0.02] border-white/[0.08] text-zinc-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <span>{modeOpt.label}</span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSelected ? "bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)]" : "bg-zinc-700"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Toggle de Legendas */}
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/[0.06]">
            <div className="space-y-0.5">
              <h5 className="text-xs font-semibold text-white">Gerar Legendas por Padrão</h5>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Sincronizar legendas no idioma dublado (exibidas no player e exportáveis).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDubbingSubtitlesEnabled((prev) => !prev)}
              aria-label="Ativar legendas na dublagem por padrão"
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors duration-200 focus:outline-none flex-shrink-0 ${
                dubbingSubtitlesEnabled ? "bg-white justify-end" : "bg-zinc-800 justify-start"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full shadow-md transition-all duration-200 ${
                  dubbingSubtitlesEnabled ? "bg-zinc-950" : "bg-zinc-400"
                }`}
              />
            </button>
          </div>

          {/* Preset de Exportação de Legendas */}
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
              Preset Padrão de Legendas ao Exportar .mp4
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                {
                  id: "mov_text" as DubbingSubtitlePreset,
                  label: "Preset 1 — Embutida Selecionável (mov_text + .srt/.vtt)",
                  desc: "Sem re-encode de vídeo (-c:v copy), faixa ativável no player e arquivos .srt/.vtt separados.",
                },
                {
                  id: "hardsub" as DubbingSubtitlePreset,
                  label: "Preset 2 — Gravada na Imagem (Hardsub NVENC)",
                  desc: "Legenda queimada permanentemente no vídeo via NVENC/x264 (ideal para redes sociais).",
                },
              ].map((presetOpt) => {
                const isSelected = dubbingSubtitlePreset === presetOpt.id;
                return (
                  <button
                    key={presetOpt.id}
                    type="button"
                    onClick={() => setDubbingSubtitlePreset(presetOpt.id)}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all duration-200 ${
                      isSelected
                        ? "bg-white/[0.1] border-white/35 shadow-[0_2px_12px_rgba(255,255,255,0.08),inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                        : "bg-white/[0.02] border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 w-full">
                      <span className="text-xs font-semibold text-white leading-snug">
                        {presetOpt.label}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${
                          isSelected ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" : "bg-zinc-700"
                        }`}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-1 leading-snug">
                      {presetOpt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>
      </div>
    </AppDialog>
  );
}
