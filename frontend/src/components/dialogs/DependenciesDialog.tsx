import { useRef, useState } from "react";
import { AppButton } from "../shared";

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
  const dialogRef = useRef<HTMLDivElement>(null);

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
    <div
      className="dialog-overlay"
      onClick={onClose}
      onWheelCapture={(event) => {
        const dialogEl = dialogRef.current;
        if (!dialogEl) {
          return;
        }

        const target = event.target as Node | null;
        const wheelOutsideDialog = !target || !dialogEl.contains(target);

        if (wheelOutsideDialog) {
          event.preventDefault();
          dialogEl.scrollTop += event.deltaY;
        }
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "500px" }}
      >
        <div className="dialog-header">
          <h3>Gerenciar dependências</h3>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
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

          <div
            style={{
              display: "flex",
              gap: "8px",
              justifyContent: "flex-end",
              marginTop: "16px",
            }}
          >
            <AppButton variant="primary" onClick={onClose}>
              Fechar
            </AppButton>
            <AppButton
              variant="secondary"
              onClick={() => {
                void onRefresh();
              }}
              disabled={refreshingDependencies}
            >
              {refreshingDependencies ? "Recarregando..." : "Recarregar status"}
            </AppButton>
          </div>
        </div>
      </div>

      {operationChoice && (
        <div
          className="dialog-overlay"
          style={{ zIndex: 1100 }}
          onClick={(e) => {
            e.stopPropagation();
            setOperationChoice(null);
          }}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", padding: "20px" }}
          >
            <h3 style={{ marginBottom: "10px" }}>Escolha como depurar o processo</h3>

            <p style={{ marginBottom: "12px", color: "var(--muted)", fontSize: "13px" }}>
              Dependência: {operationChoice.name}
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

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}
            >
              <AppButton
                variant="primary"
                onClick={() => {
                  setOperationChoice(null);
                  setSelectedViewMode(null);
                }}
                className="ds-deps-mini-btn"
              >
                Cancelar
              </AppButton>
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
                {operationChoice.mode === "install" ? "Instalar" : "Desinstalar"}
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {pytorchGpuPrompt && (
        <div
          className="dialog-overlay"
          style={{ zIndex: 1200 }}
          onClick={(e) => {
            e.stopPropagation();
            setPytorchGpuPrompt(null);
          }}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "560px", padding: "20px" }}
          >
            <h3 style={{ marginBottom: "10px" }}>Selecione seu tipo de GPU</h3>

            <p style={{ marginBottom: "12px", color: "var(--muted)", fontSize: "13px" }}>
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

            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "14px" }}
            >
              <AppButton
                variant="primary"
                onClick={() => {
                  setPytorchGpuPrompt(null);
                }}
                className="ds-deps-mini-btn"
              >
                Cancelar
              </AppButton>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
