import { useCallback, useEffect, useState } from "react";
import type {
  LmStudioModelStorageItem,
  ModelStorageItem,
  StorageUsageSummary,
} from "../../types";
import { deleteLmStudioModel, deleteModelStorage, getStorageUsage } from "../../api";
import { AppButton, AppDialog } from "../shared";
import { GlassBadge, GlassButton, GlassCard } from "../ui/glass";

function formatBytes(bytes: number | undefined | null): string {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let scaled = value;
  while (scaled >= 1024 && idx < units.length - 1) {
    scaled /= 1024;
    idx += 1;
  }
  return `${scaled.toFixed(idx >= 3 ? 2 : idx >= 1 ? 1 : 0)} ${units[idx]}`;
}

interface Dependency {
  installed: boolean;
  version: string | null;
}

type PytorchGpuTier = "rtx_4000_or_lower" | "rtx_5000";

interface DependencyInstallOptions {
  pytorchGpuTier?: PytorchGpuTier;
}

interface DependenciesDialogProps {
  dependencies: Record<string, Dependency> | null;
  loadingDependencies: Set<string>;
  installingDependency: string | null;
  uninstallingDependency: string | null;
  operationResultMessage: string | null;
  operationResultTone: "success" | "warning" | "error";
  installSessionId: string | null;
  installLogOperation: "install" | "uninstall" | null;
  installLogDependency: string | null;
  installLogStatus: "idle" | "running" | "success" | "failed" | "cancelled";
  installLogs: string[];
  showInstallLogs: boolean;
  refreshingDependencies: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onShowInstallInstructions: (name: string) => void;
  onInstallDependency: (
    name: string,
    viewMode: "terminal" | "logs",
    options?: DependencyInstallOptions,
  ) => Promise<void>;
  onUninstallDependency: (name: string, viewMode: "terminal" | "logs") => Promise<void>;
  onCancelInstallSession: (sessionId: string) => Promise<void>;
  onDownloadInstallLogs: () => void;
}

export function DependenciesDialog({
  dependencies,
  loadingDependencies,
  installingDependency,
  uninstallingDependency,
  operationResultMessage,
  operationResultTone,
  installSessionId,
  installLogOperation,
  installLogDependency,
  installLogStatus,
  installLogs,
  showInstallLogs,
  refreshingDependencies,
  onClose,
  onRefresh,
  onShowInstallInstructions,
  onInstallDependency,
  onUninstallDependency,
  onCancelInstallSession,
  onDownloadInstallLogs,
}: DependenciesDialogProps) {
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageFeedback, setStorageFeedback] = useState<string | null>(null);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<ModelStorageItem | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [confirmDeleteLmStudio, setConfirmDeleteLmStudio] =
    useState<LmStudioModelStorageItem | null>(null);
  const [deletingLmModelKey, setDeletingLmModelKey] = useState<string | null>(null);

  const loadStorageUsage = useCallback(async () => {
    setLoadingStorage(true);
    setStorageError(null);
    try {
      const summary = await getStorageUsage();
      setStorageUsage(summary);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "Falha ao calcular armazenamento do app.";
      setStorageError(msg);
    } finally {
      setLoadingStorage(false);
    }
  }, []);

  useEffect(() => {
    void loadStorageUsage();
  }, [loadStorageUsage]);

  const handleConfirmDeleteModel = async () => {
    if (!confirmDeleteModel) return;
    const target = confirmDeleteModel;
    setDeletingModelId(target.model_id);
    setStorageError(null);
    setStorageFeedback(null);
    try {
      const result = await deleteModelStorage(target.model_id);
      setConfirmDeleteModel(null);
      setStorageFeedback(
        `${target.label} removido (${formatBytes(result.freed_bytes)} liberados).`,
      );
      await loadStorageUsage();
      await onRefresh();
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : "Não foi possível remover o modelo (verifique se há tarefa ativa em execução).";
      setStorageError(
        /uso|ativa|active|409|lock|conflict/i.test(msg)
          ? `Bloqueado (em uso): ${msg}`
          : msg,
      );
      setConfirmDeleteModel(null);
    } finally {
      setDeletingModelId(null);
    }
  };

  const handleConfirmDeleteLmStudioModel = async () => {
    if (!confirmDeleteLmStudio) return;
    const target = confirmDeleteLmStudio;
    setDeletingLmModelKey(target.model_key);
    setStorageError(null);
    setStorageFeedback(null);
    try {
      const result = await deleteLmStudioModel(target.model_key);
      setConfirmDeleteLmStudio(null);
      setStorageFeedback(
        `Modelo LM Studio "${target.display_name}" removido (${formatBytes(result.freed_bytes)} liberados).`,
      );
      await loadStorageUsage();
      await onRefresh();
    } catch (error: unknown) {
      const msg =
        error instanceof Error
          ? error.message
          : "Não foi possível remover o modelo do LM Studio (verifique se está carregado na VRAM ou em uso).";
      setStorageError(
        /uso|ativa|active|409|lock|conflict/i.test(msg)
          ? `Bloqueado (em uso): ${msg}`
          : msg,
      );
      setConfirmDeleteLmStudio(null);
    } finally {
      setDeletingLmModelKey(null);
    }
  };

  const [pytorchGpuTier, setPytorchGpuTier] = useState<PytorchGpuTier | null>(() => {
    try {
      const stored = window.localStorage.getItem("pytorchGpuTier");
      if (stored === "rtx_4000_or_lower" || stored === "rtx_5000") {
        return stored;
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });

  const [pytorchGpuPrompt, setPytorchGpuPrompt] = useState<{
    name: string;
    mode: "install" | "uninstall";
  } | null>(null);

  function getDependencyCommandPreview(name: string, mode: "install" | "uninstall"): string {
    if (mode === "uninstall") {
      switch (name) {
        case "whisper":
          return "python -m pip uninstall -y openai-whisper";
        case "ytdlp":
          return "python -m pip uninstall -y yt-dlp";
        case "pytorch":
          return "python -m pip uninstall -y torch torchvision torchaudio";
        case "python":
          return "winget uninstall Python.Python.3.11";
        case "ffmpeg":
          return "winget uninstall Gyan.FFmpeg";
        default:
          return "Comando automático indisponível para esta dependência.";
      }
    }

    switch (name) {
      case "whisper":
        return "python -m pip install -U openai-whisper";
      case "ytdlp":
        return "python -m pip install -U yt-dlp";
      case "pytorch":
        if (pytorchGpuTier === "rtx_5000") {
          return [
            "python -m pip uninstall -y torch torchvision torchaudio",
            "python -m pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128",
            'python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available())"',
          ].join("\n");
        }

        if (pytorchGpuTier === "rtx_4000_or_lower") {
          return [
            "python -m pip uninstall -y torch torchvision torchaudio",
            "python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
            'python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available())"',
          ].join("\n");
        }

        return "Selecione o tipo de GPU antes de instalar o PyTorch.";
      case "python":
        return "winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements";
      case "ffmpeg":
        return "winget install Gyan.FFmpeg";
      default:
        return "Comando automático indisponível para esta dependência.";
    }
  }

  const deps = dependencies || {
    python: { installed: false, version: null },
    whisper: { installed: false, version: null },
    ytdlp: { installed: false, version: null },
    ffmpeg: { installed: false, version: null },
    cuda: { installed: false, version: null },
    pytorch: { installed: false, version: null },
    ollama: { installed: false, version: null },
  };

  const isLoadingInitial = !dependencies;
  const [operationChoice, setOperationChoice] = useState<{
    name: string;
    mode: "install" | "uninstall";
  } | null>(null);
  const [selectedViewMode, setSelectedViewMode] = useState<"terminal" | "logs" | null>(null);

  const operationLabel = installLogOperation === "uninstall" ? "desinstalação" : "instalação";

  const installStatusLabel =
    installLogStatus === "running"
      ? installLogOperation === "uninstall"
        ? "Desinstalando"
        : "Instalando"
      : installLogStatus === "success"
        ? "Concluído"
        : installLogStatus === "failed"
          ? "Falhou"
          : installLogStatus === "cancelled"
            ? "Cancelado"
            : "Parado";

  const installStatusColor =
    installLogStatus === "running"
      ? "var(--warning)"
      : installLogStatus === "success"
        ? "var(--success)"
        : installLogStatus === "failed"
          ? "var(--danger)"
          : installLogStatus === "cancelled"
            ? "var(--warning)"
            : "var(--muted)";

  const operationResultColor =
    operationResultTone === "success"
      ? "var(--success)"
      : operationResultTone === "warning"
        ? "var(--warning)"
        : "var(--danger)";

  const offlineOllama =
    deps.ollama.installed && (deps.ollama.version || "").toLowerCase().includes("server offline");

  const installedModels = (storageUsage?.models ?? []).filter(
    (item) => item.installed || item.size_bytes > 0,
  );
  const installedLmStudioModels = (storageUsage?.lmstudio_models ?? []).filter(
    (lm) => lm.size_bytes > 0 || (lm.paths && lm.paths.length > 0),
  );

  async function handleChosenViewMode(viewMode: "terminal" | "logs") {
    if (!operationChoice) {
      return;
    }

    const { name, mode } = operationChoice;
    setOperationChoice(null);
    setSelectedViewMode(null);

    if (mode === "install") {
      if (name === "pytorch") {
        if (!pytorchGpuTier) {
          setPytorchGpuPrompt({ name, mode });
          return;
        }

        const options: DependencyInstallOptions = { pytorchGpuTier };
        await onInstallDependency(name, viewMode, options);
        return;
      }

      await onInstallDependency(name, viewMode);
    } else {
      await onUninstallDependency(name, viewMode);
    }
  }

  return (
    <AppDialog
      title="Gerenciar Dependências do Sistema"
      description="Verifique e instale os binários essenciais (Python, Whisper, FFmpeg, PyTorch, yt-dlp) para o funcionamento da IA."
      onClose={onClose}
      wide
      scrollable
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <GlassButton
            variant="glass"
            size="sm"
            onClick={() => {
              void onRefresh();
              void loadStorageUsage();
            }}
            disabled={refreshingDependencies || loadingStorage}
            loading={refreshingDependencies || loadingStorage}
          >
            Atualizar Status
          </GlassButton>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.entries(deps).map(([name, status]) => {
              const isLoading = loadingDependencies.has(name);
              const isInstalling = installingDependency === name;
              const isUninstalling = uninstallingDependency === name;
              const supportsAutomaticInstall =
                name === "python" ||
                name === "whisper" ||
                name === "ytdlp" ||
                name === "ffmpeg" ||
                name === "pytorch";
              const supportsAutomaticUninstall =
                name === "python" ||
                name === "whisper" ||
                name === "ytdlp" ||
                name === "ffmpeg" ||
                name === "pytorch";
              const displayName =
                name === "pytorch"
                  ? "PyTorch"
                  : name === "ytdlp"
                    ? "yt-dlp"
                    : name.charAt(0).toUpperCase() + name.slice(1);

              return (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "14px 16px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background:
                      isLoading || isLoadingInitial ? "var(--bg-contrast)" : "var(--panel)",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                    }}
                  >
                    <div style={{ flex: 1 }}></div>
                    {isLoadingInitial ? (
                      <div className="loading-container">
                        <div className="spinner" />
                        <span
                          style={{ fontWeight: "600", fontSize: "14px", color: "var(--muted)" }}
                        >
                          {displayName}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontWeight: "600", fontSize: "14px", textAlign: "center" }}>
                        {displayName}
                        {!isLoading && status.version && (
                          <span
                            style={{
                              fontWeight: "normal",
                              color: "var(--muted)",
                              marginLeft: "6px",
                            }}
                          >
                            — {status.version}
                          </span>
                        )}
                      </span>
                    )}
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                      {isLoading || isLoadingInitial ? (
                        <div className="spinner" />
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "4px 8px",
                            borderRadius: "999px",
                            border: "1px solid var(--border)",
                            background: "var(--bg-contrast)",
                            color: "var(--muted)",
                            fontSize: "11px",
                            fontWeight: 500,
                            lineHeight: 1,
                          }}
                        >
                          <span
                            style={{
                              width: "7px",
                              height: "7px",
                              borderRadius: "999px",
                              background: status.installed ? "var(--success)" : "var(--muted)",
                            }}
                          />
                          <span>{status.installed ? "Instalado" : "Não instalado"}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    {!status.installed && (
                      <AppButton
                        onClick={() => onShowInstallInstructions(name)}
                        disabled={isLoading || isLoadingInitial}
                        variant="secondary"
                        className="ds-deps-mini-btn"
                      >
                        Instalação manual
                      </AppButton>
                    )}
                    {!status.installed && supportsAutomaticInstall && (
                      <AppButton
                        disabled={isInstalling || isUninstalling || isLoading || isLoadingInitial}
                        onClick={() => {
                          if (name === "pytorch") {
                            setPytorchGpuPrompt({ name, mode: "install" });
                            setSelectedViewMode(null);
                            return;
                          }

                          setOperationChoice({ name, mode: "install" });
                          setSelectedViewMode(null);
                        }}
                        variant="secondary"
                        className="ds-deps-mini-btn ds-deps-mini-btn--success"
                      >
                        {isInstalling ? "Instalando..." : "Instalação automática"}
                      </AppButton>
                    )}
                    {status.installed && supportsAutomaticUninstall && (
                      <AppButton
                        disabled={isInstalling || isUninstalling || isLoading || isLoadingInitial}
                        onClick={() => {
                          setOperationChoice({ name, mode: "uninstall" });
                          setSelectedViewMode(null);
                        }}
                        variant="primary"
                        className="ds-deps-mini-btn ds-deps-mini-btn--danger"
                      >
                        {isUninstalling ? "Desinstalando..." : "Desinstalar"}
                      </AppButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: "20px",
              padding: "12px",
              background: "var(--bg-contrast)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
          >
            <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: "1.5" }}>
              <strong>Nota:</strong> Dependências com status "Não instalado" precisam ser instaladas
              manualmente. Consulte a documentação do projeto para instruções.
            </p>

            {offlineOllama && (
              <p
                style={{
                  marginTop: "8px",
                  marginBottom: 0,
                  fontSize: "12px",
                  color: "var(--warning)",
                  lineHeight: "1.5",
                }}
              >
                Ollama detectado, mas com servidor offline. Mantenha o aplicativo Ollama aberto para
                que a aplicação funcione corretamente.
              </p>
            )}
          </div>

          {operationResultMessage && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                background: "var(--bg-contrast)",
                borderRadius: "8px",
                border: `1px solid ${operationResultColor}`,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  color: operationResultColor,
                  lineHeight: "1.5",
                }}
              >
                {operationResultMessage}
              </p>
            </div>
          )}

          {installLogDependency && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px",
                background: "var(--bg-contrast)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "4px",
                }}
              >
                {installLogDependency}
              </div>
              <div style={{ fontSize: "12px", color: installStatusColor, marginBottom: "4px" }}>
                {installStatusLabel}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>
                Logs da {operationLabel}
              </div>

              {showInstallLogs ? (
                <div
                  style={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    maxHeight: "220px",
                    overflowY: "auto",
                    padding: "10px",
                  }}
                >
                  {installLogs.length === 0 ? (
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "12px" }}>
                      Aguardando logs da operação...
                    </p>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: "11px",
                        lineHeight: "1.45",
                        color: "var(--ink)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {installLogs.join("\n")}
                    </pre>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                  Acompanhamento configurado para terminal do sistema.
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  justifyContent: "flex-end",
                  marginTop: "10px",
                }}
              >
                {installLogs.length > 0 && (
                  <AppButton
                    variant="secondary"
                    onClick={onDownloadInstallLogs}
                    className="ds-deps-mini-btn"
                  >
                    Baixar logs (.txt)
                  </AppButton>
                )}
                {installSessionId && installLogStatus === "running" && (
                  <AppButton
                    variant="primary"
                    onClick={() => {
                      void onCancelInstallSession(installSessionId);
                    }}
                    className="ds-deps-mini-btn"
                  >
                    Cancelar execução
                  </AppButton>
                )}
              </div>
            </div>
          )}

      {/* Armazenamento do App & Modelos */}
      <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-4 mt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-white">
              Armazenamento do App &amp; Modelos
            </h4>
            <p className="text-xs text-zinc-400">
              Total App Size = Modelos/Dependências + Vídeos/Dublagens/Cortes{" "}
              <span className="text-zinc-500">
                (LM Studio externo medido em card separado)
              </span>
            </p>
          </div>
          <GlassButton
            variant="glass"
            size="sm"
            onClick={() => void loadStorageUsage()}
            loading={loadingStorage}
            disabled={loadingStorage}
          >
            Recalcular
          </GlassButton>
        </div>

        {storageError && (
          <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200 leading-relaxed">
            {storageError}
          </div>
        )}

        {storageFeedback && (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-200 leading-relaxed">
            {storageFeedback}
          </div>
        )}

        {loadingStorage && !storageUsage ? (
          <div className="flex items-center gap-2 py-3 text-xs text-zinc-400">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            <span>Calculando espaço ocupado em disco...</span>
          </div>
        ) : storageUsage ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <span className="text-[11px] uppercase tracking-wider text-zinc-400 block">
                  Total App Size
                </span>
                <span className="text-base font-mono font-bold text-white mt-0.5 block">
                  {formatBytes(storageUsage.total_app_bytes)}
                </span>
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] p-3">
                <span className="text-[11px] uppercase tracking-wider text-cyan-300/80 block">
                  Modelos / Dependências
                </span>
                <span className="text-base font-mono font-bold text-cyan-200 mt-0.5 block">
                  {formatBytes(storageUsage.total_models_bytes)}
                </span>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                <span className="text-[11px] uppercase tracking-wider text-emerald-300/80 block">
                  Vídeos / Dublagens / Cortes
                </span>
                <span className="text-base font-mono font-bold text-emerald-200 mt-0.5 block">
                  {formatBytes(storageUsage.total_media_bytes)}
                </span>
              </div>
              <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.07] p-3">
                <span className="text-[11px] uppercase tracking-wider text-violet-300/85 block">
                  LM Studio (Externo)
                </span>
                <span className="text-base font-mono font-bold text-violet-200 mt-0.5 block">
                  {formatBytes(storageUsage.lmstudio_models_bytes ?? 0)}
                </span>
                <span className="text-[10px] text-zinc-400 mt-0.5 block">
                  Total c/ LM Studio:{" "}
                  <span className="font-mono text-zinc-200">
                    {formatBytes(
                      storageUsage.total_with_lmstudio_bytes ?? storageUsage.total_app_bytes,
                    )}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5">
                Vídeos: {formatBytes(storageUsage.videos_bytes)}
              </span>
              <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5">
                Dublagens: {formatBytes(storageUsage.dubs_bytes)}
              </span>
              <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5">
                Stems: {formatBytes(storageUsage.stems_bytes)}
              </span>
              <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5">
                Shorts: {formatBytes(storageUsage.shorts_bytes)}
              </span>
              <span className="rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-0.5">
                Arquivados: {formatBytes(storageUsage.archives_bytes)}
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 block">
                Modelos &amp; Ambientes Isolados ({installedModels.length})
              </span>
              {installedModels.length === 0 ? (
                <p className="text-xs text-zinc-500 m-0">
                  Nenhum modelo ou ambiente do app encontrado em disco.
                </p>
              ) : (
                <div className="space-y-2">
                  {installedModels.map((item) => {
                    const isBusy = deletingModelId === item.model_id;
                    return (
                      <div
                        key={item.model_id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-white">
                              {item.label}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400 bg-white/[0.05] border border-white/[0.08] px-1.5 py-0.5 rounded">
                              {item.model_id}
                            </span>
                            <GlassBadge
                              variant={item.installed ? "success" : "neutral"}
                              size="sm"
                            >
                              {item.installed ? "Instalado" : "Ausente"}
                            </GlassBadge>
                          </div>
                          {item.paths && item.paths.length > 1 ? (
                            <div className="space-y-0.5">
                              {item.paths.map((p) => (
                                <p
                                  key={p}
                                  className="text-[11px] text-zinc-500 font-mono truncate m-0"
                                  title={p}
                                >
                                  {p}
                                </p>
                              ))}
                            </div>
                          ) : (
                            item.path && (
                              <p
                                className="text-[11px] text-zinc-500 font-mono truncate m-0"
                                title={item.path}
                              >
                                {item.path}
                              </p>
                            )
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          <span className="font-mono text-xs font-semibold text-zinc-200">
                            {formatBytes(item.size_bytes)}
                          </span>
                          {item.installed && item.deletable && (
                            <GlassButton
                              variant="danger"
                              size="sm"
                              disabled={Boolean(deletingModelId || deletingLmModelKey)}
                              loading={isBusy}
                              onClick={() => setConfirmDeleteModel(item)}
                            >
                              Excluir
                            </GlassButton>
                          )}
                          {item.installed && !item.deletable && (
                            <GlassBadge variant="neutral" size="sm">
                              Base do App
                            </GlassBadge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <span className="text-xs font-semibold uppercase tracking-wider text-violet-300/90 block">
                Modelos no LM Studio ({installedLmStudioModels.length})
              </span>
              {installedLmStudioModels.length === 0 ? (
                <p className="text-xs text-zinc-500 m-0">
                  Nenhum modelo do LM Studio encontrado em disco.
                </p>
              ) : (
                <div className="space-y-2">
                  {installedLmStudioModels.map((lm) => {
                    const isBusyLm = deletingLmModelKey === lm.model_key;
                    return (
                      <div
                        key={lm.model_key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-white">
                              {lm.display_name}
                            </span>
                            <span className="font-mono text-[10px] text-zinc-400 bg-white/[0.05] border border-white/[0.08] px-1.5 py-0.5 rounded">
                              {lm.model_key}
                            </span>
                            <GlassBadge variant="neutral" size="sm">
                              {lm.model_type}
                            </GlassBadge>
                            {lm.quantization && (
                              <span className="font-mono text-[10px] text-violet-200/90 bg-violet-500/15 border border-violet-400/25 px-1.5 py-0.5 rounded">
                                {lm.quantization}
                              </span>
                            )}
                          </div>
                          {lm.paths && lm.paths.length > 0 && (
                            <div className="space-y-0.5">
                              {lm.paths.map((p) => (
                                <p
                                  key={p}
                                  className="text-[11px] text-zinc-500 font-mono truncate m-0"
                                  title={p}
                                >
                                  {p}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          <span className="font-mono text-xs font-semibold text-zinc-200">
                            {formatBytes(lm.size_bytes)}
                          </span>
                          {lm.deletable ? (
                            <GlassButton
                              variant="danger"
                              size="sm"
                              disabled={Boolean(deletingModelId || deletingLmModelKey)}
                              loading={isBusyLm}
                              onClick={() => setConfirmDeleteLmStudio(lm)}
                            >
                              Excluir
                            </GlassButton>
                          ) : (
                            <GlassBadge variant="neutral" size="sm">
                              {lm.bundled ? "Embutido" : "Protegido"}
                            </GlassBadge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : null}
      </GlassCard>

      {confirmDeleteModel && (
        <AppDialog
          title="Remover Modelo / Ambiente Local"
          description="Libere espaço em disco removendo arquivos baixados localmente."
          onClose={() => {
            if (!deletingModelId) setConfirmDeleteModel(null);
          }}
          disableClose={Boolean(deletingModelId)}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDeleteModel(null)}
                disabled={Boolean(deletingModelId)}
              >
                Cancelar
              </GlassButton>
              <GlassButton
                variant="danger"
                size="sm"
                loading={Boolean(deletingModelId)}
                disabled={Boolean(deletingModelId)}
                onClick={() => void handleConfirmDeleteModel()}
              >
                Confirmar Exclusão
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-3 py-1">
            <p className="text-xs text-zinc-200 leading-relaxed m-0">
              Tem certeza que deseja excluir{" "}
              <strong className="text-white">{confirmDeleteModel.label}</strong> (
              <span className="font-mono">{formatBytes(confirmDeleteModel.size_bytes)}</span>)?
            </p>
            <p className="text-[11px] text-zinc-400 leading-relaxed m-0">
              Se precisar usar este recurso novamente, ele será baixado de forma automática pelo preflight.
              {confirmDeleteModel.model_id === "venv_base" &&
                " Atenção: remover .venv-dubbing-base também limpa os ambientes dependentes (.venv-qwen3 e .venv-chatterbox)."}
            </p>
          </div>
        </AppDialog>
      )}

      {confirmDeleteLmStudio && (
        <AppDialog
          title="Excluir Modelo Externo do LM Studio"
          description="Esta ação apaga permanentemente os arquivos GGUF do LM Studio no disco."
          onClose={() => {
            if (!deletingLmModelKey) setConfirmDeleteLmStudio(null);
          }}
          disableClose={Boolean(deletingLmModelKey)}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDeleteLmStudio(null)}
                disabled={Boolean(deletingLmModelKey)}
              >
                Cancelar
              </GlassButton>
              <GlassButton
                variant="danger"
                size="sm"
                loading={Boolean(deletingLmModelKey)}
                disabled={Boolean(deletingLmModelKey)}
                onClick={() => void handleConfirmDeleteLmStudioModel()}
              >
                Confirmar Exclusão
              </GlassButton>
            </div>
          }
        >
          <div className="space-y-3 py-1">
            <p className="text-xs text-zinc-200 leading-relaxed m-0">
              Tem certeza que deseja excluir{" "}
              <strong className="text-white">{confirmDeleteLmStudio.display_name}</strong>{" "}
              (<span className="font-mono">{confirmDeleteLmStudio.model_key}</span> ·{" "}
              <span className="font-mono">{formatBytes(confirmDeleteLmStudio.size_bytes)}</span>)?
            </p>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
              Atenção: modelos do LM Studio são compartilhados externamente no sistema.
              Outros aplicativos ou fluxos locais que dependam deste modelo deixarão de
              encontrá-lo até você baixá-lo novamente pelo LM Studio. Se o modelo estiver
              carregado na VRAM agora, descarregue-o antes de excluir.
            </div>
          </div>
        </AppDialog>
      )}

          {operationChoice && (
        <AppDialog
          title="Escolha como depurar o processo"
          onClose={() => {
            setOperationChoice(null);
            setSelectedViewMode(null);
          }}
          className="max-w-xl"
          footer={
            <AppButton
              variant="secondary"
              disabled={!selectedViewMode}
              onClick={() => {
                if (!selectedViewMode) {
                  return;
                }
                void handleChosenViewMode(selectedViewMode);
              }}
              className="ds-deps-mini-btn"
            >
              {operationChoice.mode === "install" ? "Iniciar Instalação" : "Iniciar Desinstalação"}
            </AppButton>
          }
        >
          <div className="p-4 space-y-4">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
              Dependência: <strong className="text-white">{operationChoice.name}</strong>
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <AppButton
                variant="secondary"
                onClick={() => {
                  setSelectedViewMode("terminal");
                }}
                title="Abre o terminal do Windows com o comando da operação"
                className={`ds-deps-choice-btn ${selectedViewMode === "terminal" ? "is-active" : ""}`.trim()}
              >
                Abrir terminal
              </AppButton>

              <AppButton
                variant="secondary"
                onClick={() => {
                  setSelectedViewMode("logs");
                }}
                title="Mantém a operação na aplicação e mostra logs em tempo real"
                className={`ds-deps-choice-btn ${selectedViewMode === "logs" ? "is-active" : ""}`.trim()}
              >
                Mostrar logs integrados
              </AppButton>
            </div>

            <div
              style={{
                marginTop: "10px",
                padding: "10px",
                background: "var(--bg-contrast)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            >
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>
                Comando que será executado:
              </div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: "monospace",
                  fontSize: "12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--ink)",
                }}
              >
                {getDependencyCommandPreview(operationChoice.name, operationChoice.mode)}
              </pre>
            </div>
          </div>
        </AppDialog>
      )}

      {pytorchGpuPrompt && (
        <AppDialog
          title="Selecione seu tipo de GPU"
          onClose={() => setPytorchGpuPrompt(null)}
          className="max-w-xl"
          footer={
            <AppButton
              variant="secondary"
              disabled={!pytorchGpuTier}
              onClick={() => {
                if (!pytorchGpuTier) {
                  return;
                }

                setPytorchGpuPrompt(null);
                setOperationChoice(pytorchGpuPrompt);
                setSelectedViewMode(null);
              }}
              className="ds-deps-mini-btn"
            >
              Continuar
            </AppButton>
          }
        >
          <div className="p-4 space-y-4">
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
              Antes de continuar, escolha qual opção corresponde à sua placa de vídeo.
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <AppButton
                variant="secondary"
                onClick={() => {
                  setPytorchGpuTier("rtx_4000_or_lower");
                  try {
                    window.localStorage.setItem("pytorchGpuTier", "rtx_4000_or_lower");
                  } catch {
                    // ignore storage errors
                  }
                }}
                className={`ds-deps-choice-btn ${pytorchGpuTier === "rtx_4000_or_lower" ? "is-active" : ""}`.trim()}
              >
                RTX 4000 series ou inferior
              </AppButton>

              <AppButton
                variant="secondary"
                onClick={() => {
                  setPytorchGpuTier("rtx_5000");
                  try {
                    window.localStorage.setItem("pytorchGpuTier", "rtx_5000");
                  } catch {
                    // ignore storage errors
                  }
                }}
                className={`ds-deps-choice-btn ${pytorchGpuTier === "rtx_5000" ? "is-active" : ""}`.trim()}
              >
                RTX 5000 series
              </AppButton>
            </div>
          </div>
        </AppDialog>
      )}
    </AppDialog>
  );
}
