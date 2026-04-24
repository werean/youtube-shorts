import { useEffect, useRef, useState } from "react";
import {
  cancelDependencyInstallSession,
  getDependencies,
  getDependencyInstallSession,
  openDependencyInstallTerminal,
  startDependencyInstallSession,
  startDependencyUninstallSession,
  type DependencyInstallOptions,
  type DependencyInstallSessionStatus,
  type DependencyOperationMode,
  type InstallDependencyResult,
} from "../api/config";

interface DependencyStatus {
  installed: boolean;
  version: string | null;
}

type DependenciesState = Record<string, DependencyStatus> | null;

interface DependencyOperationFeedback {
  kind: "success" | "warning" | "error";
  message: string;
}

function normalizeDependencySnapshot(snapshot: Record<string, DependencyStatus>) {
  return {
    python: { ...snapshot.python },
    whisper: { ...snapshot.whisper },
    ytdlp: { ...snapshot.ytdlp },
    ffmpeg: { ...snapshot.ffmpeg },
    cuda: { ...snapshot.cuda },
    pytorch: { ...snapshot.pytorch },
    ollama: { ...snapshot.ollama },
  };
}

function unavailableDependencySnapshot() {
  return {
    python: { installed: false, version: null },
    whisper: { installed: false, version: null },
    ffmpeg: { installed: false, version: null },
    cuda: { installed: false, version: null },
    pytorch: { installed: false, version: null },
    ollama: { installed: false, version: null },
  };
}

export function useDependencyManagementWorkflow() {
  const [dependencies, setDependencies] = useState<DependenciesState>(null);
  const [refreshingDependencies, setRefreshingDependencies] = useState(false);
  const [loadingDependencies, setLoadingDependencies] = useState<Set<string>>(new Set());
  const [installingDependency, setInstallingDependency] = useState<string | null>(null);
  const [uninstallingDependency, setUninstallingDependency] = useState<string | null>(null);
  const [dependencyOperationFeedback, setDependencyOperationFeedback] =
    useState<DependencyOperationFeedback | null>(null);
  const dependencyInstallPollRef = useRef<number | null>(null);
  const [dependencyInstallSessionId, setDependencyInstallSessionId] = useState<string | null>(null);
  const [dependencyInstallLogs, setDependencyInstallLogs] = useState<string[]>([]);
  const [dependencyInstallLogDependency, setDependencyInstallLogDependency] = useState<
    string | null
  >(null);
  const [dependencyLogOperation, setDependencyLogOperation] =
    useState<DependencyOperationMode | null>(null);
  const [dependencyInstallLogStatus, setDependencyInstallLogStatus] = useState<
    DependencyInstallSessionStatus | "idle"
  >("idle");
  const [showDependencyInstallLogs, setShowDependencyInstallLogs] = useState(false);

  function stopDependencyInstallPolling() {
    if (dependencyInstallPollRef.current !== null) {
      window.clearInterval(dependencyInstallPollRef.current);
      dependencyInstallPollRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      stopDependencyInstallPolling();
    };
  }, []);

  function clearDependencyLoading(name: string) {
    setLoadingDependencies((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  async function loadDependencies() {
    try {
      const depsData = await getDependencies();
      setDependencies(depsData.dependencies);
    } catch (error) {
      console.error("Failed to load dependencies:", error);
    }
  }

  async function refreshDependencies(showAlertOnError = false): Promise<boolean> {
    setRefreshingDependencies(true);
    try {
      const depsData = await getDependencies();
      setDependencies(normalizeDependencySnapshot(depsData.dependencies));
      if (!installingDependency && !uninstallingDependency) {
        setLoadingDependencies(new Set());
      }
      return true;
    } catch (error) {
      console.error("Failed to refresh dependencies:", error);
      if (showAlertOnError) {
        alert("Não foi possível atualizar as dependências no momento.");
      }
      return false;
    } finally {
      setRefreshingDependencies(false);
    }
  }

  async function openSystemTerminalForDependency(
    name: string,
    mode: DependencyOperationMode,
    showFeedback = false,
    options?: DependencyInstallOptions,
  ): Promise<boolean> {
    try {
      const result = await openDependencyInstallTerminal(name, mode, options);
      if (showFeedback) {
        const commandInfo = result.command ? `\n\nComando:\n${result.command}` : "";
        alert(`${result.message}${commandInfo}`);
      }
      return true;
    } catch (error) {
      console.error(`Failed to open terminal for ${name}:`, error);
      if (showFeedback) {
        alert(`Não foi possível abrir o terminal para ${name}.`);
      }
      return false;
    }
  }

  async function finalizeDependencyOperation(
    operation: DependencyOperationMode,
    name: string,
    status: "success" | "failed" | "cancelled",
    result?: InstallDependencyResult,
  ) {
    try {
      if (result?.dependencies) {
        setDependencies(result.dependencies);
      } else {
        const depsData = await getDependencies();
        setDependencies(depsData.dependencies);
      }
    } catch (refreshError) {
      console.error("Failed to refresh dependencies after install session:", refreshError);
    }

    const operationVerb = operation === "uninstall" ? "desinstalação" : "instalação";

    if (status === "cancelled") {
      setDependencyOperationFeedback({
        kind: "warning",
        message: `A ${operationVerb} de ${name} foi cancelada.`,
      });
    } else if (status === "success" && result?.success) {
      const installerInfo = result.installer ? ` (Instalador: ${result.installer})` : "";
      setDependencyOperationFeedback({
        kind: "success",
        message: `${result.message}${installerInfo}`,
      });
    } else if (result) {
      const categoryInfo = result.failureCategory ? `\nCategoria: ${result.failureCategory}` : "";
      const details = result.error || result.output;
      const diagnosticsInfo = result.diagnostics?.length
        ? `\n\nDiagnóstico:\n${result.diagnostics.join("\n")}`
        : "";
      const detailsInfo = details ? `\n\n${details}` : "\n\nSem detalhes adicionais";
      setDependencyOperationFeedback({
        kind: "error",
        message: result.message || `Falha na ${operationVerb} de ${name}.`,
      });
      alert(`${result.message}${categoryInfo}${detailsInfo}${diagnosticsInfo}`);
    } else {
      setDependencyOperationFeedback({
        kind: "warning",
        message: `A ${operationVerb} de ${name} terminou sem retornar um resultado válido.`,
      });
      alert(`A ${operationVerb} de ${name} terminou sem retornar um resultado válido.`);
    }

    clearDependencyLoading(name);
    if (operation === "install") {
      setInstallingDependency(null);
    } else {
      setUninstallingDependency(null);
    }
    setDependencyInstallSessionId(null);
    setDependencyLogOperation(null);
  }

  async function pollDependencyInstallSession(
    sessionId: string,
    name: string,
    operation: DependencyOperationMode,
  ): Promise<boolean> {
    const session = await getDependencyInstallSession(sessionId);
    setDependencyInstallLogs(session.logs || []);
    setDependencyInstallLogStatus(session.status);
    setDependencyLogOperation(session.operation || operation);

    if (session.status === "running") {
      return true;
    }

    stopDependencyInstallPolling();
    await finalizeDependencyOperation(
      session.operation || operation,
      name,
      session.status,
      session.result,
    );
    return false;
  }

  async function cancelActiveDependencyInstallSession(): Promise<void> {
    if (!dependencyInstallSessionId) {
      return;
    }

    try {
      const result = await cancelDependencyInstallSession(dependencyInstallSessionId);
      setDependencyInstallLogs((prev) => [...prev, `[local] ${result.message}`]);
    } catch (error) {
      console.error("Failed to request install session cancellation:", error);
      alert("Não foi possível cancelar a execução no momento.");
    }
  }

  function downloadDependencyLogsAsTxt() {
    if (dependencyInstallLogs.length === 0) {
      alert("Não há logs disponíveis para download.");
      return;
    }

    const dependency = dependencyInstallLogDependency || "dependencia";
    const operation = dependencyLogOperation || "install";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeDependency = dependency.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeDependency}-${operation}-${timestamp}.txt`;

    const payload = [
      `Dependência: ${dependency}`,
      `Operação: ${operation}`,
      `Status: ${dependencyInstallLogStatus}`,
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      "",
      ...dependencyInstallLogs,
    ].join("\n");

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function startDependencyOperationSession(
    name: string,
    operation: DependencyOperationMode,
    viewMode: "terminal" | "logs",
    options?: DependencyInstallOptions,
  ): Promise<void> {
    const operationLabel = operation === "uninstall" ? "desinstalação" : "instalação";
    setDependencyOperationFeedback(null);

    if (operation === "install") {
      setInstallingDependency(name);
      setUninstallingDependency(null);
    } else {
      setUninstallingDependency(name);
      setInstallingDependency(null);
    }

    setDependencyInstallLogDependency(name);
    setDependencyLogOperation(operation);
    setDependencyInstallLogStatus("running");
    setDependencyInstallLogs([`[local] Iniciando sessão de ${operationLabel} para ${name}...`]);
    setShowDependencyInstallLogs(viewMode === "logs");

    setLoadingDependencies((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });

    try {
      stopDependencyInstallPolling();

      if (viewMode === "terminal") {
        const terminalOpened = await openSystemTerminalForDependency(
          name,
          operation,
          false,
          options,
        );

        if (terminalOpened) {
          setDependencyInstallSessionId(null);
          setDependencyInstallLogStatus("idle");
          setDependencyInstallLogs([]);
          setShowDependencyInstallLogs(false);
          setDependencyOperationFeedback({
            kind: "success",
            message: `Comando de ${operationLabel} de ${name} enviado para o terminal externo.`,
          });
          clearDependencyLoading(name);
          if (operation === "install") {
            setInstallingDependency(null);
          } else {
            setUninstallingDependency(null);
          }
          void refreshDependencies(false);
          return;
        }

        setShowDependencyInstallLogs(true);
        setDependencyInstallLogs((prev) => [
          ...prev,
          "[local] Falha ao abrir terminal. Exibindo logs integrados.",
        ]);
      }

      const sessionStart =
        operation === "install"
          ? await startDependencyInstallSession(name, options)
          : await startDependencyUninstallSession(name);

      setDependencyInstallSessionId(sessionStart.sessionId);
      setDependencyInstallLogs((prev) => [
        ...prev,
        `[local] Sessão criada (${operation}): ${sessionStart.sessionId}`,
      ]);

      const shouldContinuePolling = await pollDependencyInstallSession(
        sessionStart.sessionId,
        name,
        operation,
      );

      if (shouldContinuePolling) {
        dependencyInstallPollRef.current = window.setInterval(() => {
          void pollDependencyInstallSession(sessionStart.sessionId, name, operation).catch(
            (pollError) => {
              console.error(
                `Failed to poll dependency ${operation} session for ${name}:`,
                pollError,
              );
              stopDependencyInstallPolling();
              setDependencyInstallLogStatus("failed");
              setDependencyInstallLogs((prev) => [
                ...prev,
                `[local] Falha ao consultar logs da sessão ${sessionStart.sessionId}.`,
              ]);
              void finalizeDependencyOperation(operation, name, "failed", {
                success: false,
                message: `Erro ao acompanhar ${operationLabel} de ${name}`,
                error: pollError instanceof Error ? pollError.message : String(pollError),
              });
            },
          );
        }, 1200);
      }
    } catch (error) {
      console.error(`Failed to start dependency ${operation} session for ${name}:`, error);
      stopDependencyInstallPolling();
      setDependencyInstallSessionId(null);
      setDependencyInstallLogStatus("failed");
      setDependencyInstallLogs((prev) => [
        ...prev,
        `[local] Não foi possível iniciar a sessão de ${operationLabel} de ${name}.`,
      ]);
      clearDependencyLoading(name);
      if (operation === "install") {
        setInstallingDependency(null);
      } else {
        setUninstallingDependency(null);
      }
      alert(
        `Erro ao iniciar ${operationLabel} de ${name}. Verifique permissões, PATH e conflitos de versão.`,
      );
    }
  }

  async function prepareDependenciesDialog(): Promise<void> {
    setDependencyOperationFeedback(null);
    setDependencies(null);
    setRefreshingDependencies(false);
    setLoadingDependencies(new Set());
    stopDependencyInstallPolling();
    setDependencyInstallSessionId(null);
    setDependencyInstallLogs([]);
    setDependencyInstallLogDependency(null);
    setDependencyLogOperation(null);
    setDependencyInstallLogStatus("idle");
    setShowDependencyInstallLogs(false);
    setInstallingDependency(null);
    setUninstallingDependency(null);
    const loaded = await refreshDependencies(false);

    if (!loaded) {
      setDependencies(unavailableDependencySnapshot());
    }

    setLoadingDependencies(new Set());
  }

  return {
    dependencies,
    loadingDependencies,
    installingDependency,
    uninstallingDependency,
    dependencyOperationFeedback,
    dependencyInstallSessionId,
    dependencyLogOperation,
    dependencyInstallLogDependency,
    dependencyInstallLogStatus,
    dependencyInstallLogs,
    showDependencyInstallLogs,
    refreshingDependencies,
    loadDependencies,
    refreshDependencies,
    prepareDependenciesDialog,
    startDependencyOperationSession,
    cancelActiveDependencyInstallSession,
    downloadDependencyLogsAsTxt,
  };
}
