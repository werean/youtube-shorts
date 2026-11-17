import { useEffect } from "react";
import {
  Cpu,
  FilmStrip,
  Gear,
  ListChecks,
  Microphone,
  Question,
  Sparkle,
  X,
} from "@phosphor-icons/react";

interface SettingsHubModalProps {
  open: boolean;
  onClose: () => void;
  onConfigureApp: () => void;
  onManageDependencies: () => void;
  onConfigureLLM: () => void;
  onConfigureWhisper: () => void;
  onConfigureFFmpeg: () => void;
  onOpenBatchPipeline: () => void;
  onShowHowToUse: () => void;
}

export function SettingsHubModal({
  open,
  onClose,
  onConfigureApp,
  onManageDependencies,
  onConfigureLLM,
  onConfigureWhisper,
  onConfigureFFmpeg,
  onOpenBatchPipeline,
  onShowHowToUse,
}: SettingsHubModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const items = [
    {
      id: "app",
      title: "Aplicação",
      description: "Pasta de mídia, qualidade de download e confirmações",
      icon: Gear,
      onClick: () => {
        onClose();
        onConfigureApp();
      },
    },
    {
      id: "dependencies",
      title: "Dependências",
      description: "Python, FFmpeg, Whisper, yt-dlp e Ollama",
      icon: Cpu,
      onClick: () => {
        onClose();
        onManageDependencies();
      },
    },
    {
      id: "llm",
      title: "IA e Modelos",
      description: "Modelo Ollama, embeddings e instruções de corte",
      icon: Sparkle,
      onClick: () => {
        onClose();
        onConfigureLLM();
      },
    },
    {
      id: "whisper",
      title: "Transcrição",
      description: "Modelo Whisper, idioma e dispositivo",
      icon: Microphone,
      onClick: () => {
        onClose();
        onConfigureWhisper();
      },
    },
    {
      id: "ffmpeg",
      title: "Renderização",
      description: "Formato vertical, legenda e codificação de vídeo",
      icon: FilmStrip,
      onClick: () => {
        onClose();
        onConfigureFFmpeg();
      },
    },
  ];

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Configurações"
        className="w-full max-w-[460px] rounded-panel glass--strong p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-text-1">Configurações</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 transition-colors duration-fast"
          >
            <X size={15} weight="regular" />
          </button>
        </div>

        <div className="space-y-1.5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-item text-left hover:bg-glass-hover transition-colors duration-fast group"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-item bg-glass text-text-2 group-hover:text-text-1 transition-colors duration-fast">
                  <Icon size={16} weight="regular" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text-1">{item.title}</div>
                  <div className="text-xs text-text-3 truncate">{item.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenBatchPipeline();
            }}
            className="inline-flex items-center gap-2 h-8 px-3 rounded-pill text-xs font-medium text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
          >
            <ListChecks size={14} weight="regular" />
            <span>Processar em lote</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onShowHowToUse();
            }}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-pill text-xs font-medium text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
          >
            <Question size={14} weight="regular" />
            <span>Como usar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
