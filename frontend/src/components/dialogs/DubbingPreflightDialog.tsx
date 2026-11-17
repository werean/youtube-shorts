import type { DubbingPreflightResult } from "../../types";
import { AppDialog } from "../shared";
import { GlassBadge, GlassButton, GlassCard } from "../ui/glass";

export interface DubbingPreflightDialogProps {
  preflight: DubbingPreflightResult;
  isStarting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatEngineLabel(engine: string): string {
  return engine === "chatterbox" ? "Chatterbox Multilingual" : "Qwen3-TTS-1.7B";
}

function formatGb(gb: number | undefined | null): string {
  const num = Number(gb || 0);
  if (!Number.isFinite(num) || num <= 0) return "0.0 GB";
  return `${num.toFixed(num >= 10 ? 1 : 2)} GB`;
}

export function DubbingPreflightDialog({
  preflight,
  isStarting = false,
  onConfirm,
  onCancel,
}: DubbingPreflightDialogProps) {
  const missingItems = preflight.missing || [];
  const lowDisk = !preflight.disk_sufficient;

  return (
    <AppDialog
      title="Preparar Ambiente de Dublagem (IA Local)"
      description="Primeira execução ou componente ausente: revise o que será baixado localmente antes de iniciar."
      onClose={onCancel}
      disableClose={isStarting}
      size="lg"
      scrollable
      footer={
        <div className="flex items-center justify-between gap-3 w-full flex-wrap">
          <span className="text-[11px] text-zinc-400">
            Download 100% local — sem custos de API na nuvem
          </span>
          <div className="flex items-center gap-2.5">
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isStarting}
            >
              Cancelar
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              onClick={onConfirm}
              loading={isStarting}
              disabled={isStarting}
              leadingIcon={
                !isStarting ? (
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
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                ) : undefined
              }
            >
              {isStarting ? "Iniciando..." : "Baixar e Iniciar"}
            </GlassButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Resumo de Motor e Espaço em Disco */}
        <GlassCard className="p-3.5 border-white/10 bg-white/[0.025] flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold block">
              Motor selecionado
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">
                {formatEngineLabel(String(preflight.engine))}
              </span>
              <GlassBadge variant="accent" size="sm">
                PyTorch CUDA cu128
              </GlassBadge>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[11px] text-zinc-400 block">Download total</span>
              <span className="text-sm font-mono font-bold text-cyan-300">
                {formatGb(preflight.total_download_gb)}
              </span>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div className="text-right">
              <span className="text-[11px] text-zinc-400 block">Disco livre</span>
              <span
                className={`text-sm font-mono font-bold ${
                  lowDisk ? "text-rose-400" : "text-emerald-300"
                }`}
              >
                {formatGb(preflight.free_disk_gb)}
              </span>
            </div>
          </div>
        </GlassCard>

        {/* Aviso de Disco Baixo */}
        {lowDisk && (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 flex items-start gap-3">
            <svg
              className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div className="space-y-1 text-xs text-rose-200 leading-relaxed">
              <p className="font-semibold m-0">Espaço em disco insuficiente ou muito baixo</p>
              <p className="m-0 text-rose-100/80">
                São necessários aproximadamente{" "}
                <strong>{formatGb(preflight.total_download_gb)}</strong>, mas apenas{" "}
                <strong>{formatGb(preflight.free_disk_gb)}</strong> estão disponíveis. Libere espaço em disco antes de iniciar para evitar falhas no download.
              </p>
            </div>
          </div>
        )}

        {/* Lista de Itens Faltantes */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Componentes a instalar ({missingItems.length})
            </span>
            <span className="text-[11px] text-zinc-500">
              Armazenados localmente na pasta do app
            </span>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
            {missingItems.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-400">
                Todos os itens principais estão prontos; apenas verificação final será executada.
              </div>
            ) : (
              missingItems.map((item) => {
                const isVenv = item.category === "venv";
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-white">
                          {item.label}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                            isVenv
                              ? "border-purple-400/30 bg-purple-500/15 text-purple-200"
                              : "border-cyan-400/30 bg-cyan-500/15 text-cyan-200"
                          }`}
                        >
                          {isVenv ? "Ambiente Python / cu128" : "Pesos IA"}
                        </span>
                      </div>
                      {item.path && (
                        <p className="text-[11px] text-zinc-500 font-mono truncate m-0" title={item.path}>
                          {item.path}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-xs font-semibold text-zinc-200 flex-shrink-0">
                      {formatGb(item.estimated_gb)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Explicação de Execução Paralela */}
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.07] p-3.5 flex items-start gap-3">
          <svg
            className="w-5 h-5 text-cyan-300 flex-shrink-0 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <div className="space-y-1 text-xs text-cyan-100/90 leading-relaxed">
            <p className="font-semibold text-cyan-200 m-0">
              Preparação em paralelo durante o download
            </p>
            <p className="m-0 text-cyan-100/80">
              Enquanto os ambientes e pesos do TTS são baixados, o ClipFlow já inicia em paralelo a transcrição do áudio e a tradução contextual via LLM local para acelerar a dublagem.
            </p>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
