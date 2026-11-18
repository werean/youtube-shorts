import {
  ArrowsClockwise,
  Brain,
  Cpu,
  Cube,
  DownloadSimple,
  FilmStrip,
  FolderOpen,
  FolderSimple,
  Microphone,
  Monitor,
  DotsThree,
  Terminal,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { selectFolder, type PytorchGpuTier } from "../../../api";
import {
  GhostButton,
  PickTile,
  PickTileGroup,
  SettingsSectionLabel,
  SettingsSwitch,
  StatusDot,
  type AppSettingsPatch,
  type AutoSaveReporter,
  type DownloadResolution,
} from "./settingsShared";

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/** Executa um salvamento reportando saving → saved/error. Retorna `true` se salvou. */
async function persist(
  save: (patch: AppSettingsPatch) => void | Promise<void>,
  patch: AppSettingsPatch,
  reporter?: AutoSaveReporter,
): Promise<boolean> {
  reporter?.reportSaving();
  try {
    await save(patch);
    reporter?.reportSaved();
    return true;
  } catch (error) {
    reporter?.reportError(errorMessage(error));
    return false;
  }
}

const CARD_CLASS = "rounded-card border border-line bg-glass";

/* -------------------------------------------------------------------------- */
/* Tela 01 — Aplicação › Pastas                                                */
/* -------------------------------------------------------------------------- */

export interface AppFoldersSectionProps {
  baseDir: string;
  askDeleteCutConfirm: boolean;
  /**
   * Persiste um patch parcial. O handler do pai deve preservar
   * `preferences.ask_move_on_upload` / `preferences.move_uploads` e `media.download_resolution`.
   */
  onSaveAppSettings: (patch: AppSettingsPatch) => void | Promise<void>;
  reporter?: AutoSaveReporter;
}

export function AppFoldersSection({
  baseDir,
  askDeleteCutConfirm,
  onSaveAppSettings,
  reporter,
}: AppFoldersSectionProps) {
  const [draft, setDraft] = useState(baseDir);
  const [editing, setEditing] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(askDeleteCutConfirm);
  const [pickingFolder, setPickingFolder] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      setDraft(baseDir);
    }
  }, [baseDir, editing]);

  useEffect(() => {
    setConfirmDelete(askDeleteCutConfirm);
  }, [askDeleteCutConfirm]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  async function commitPath(value: string): Promise<void> {
    const next = value.trim();
    if (!next) {
      setPathError("Informe uma pasta válida.");
      inputRef.current?.focus();
      return;
    }

    setPathError(null);
    cancelledRef.current = true;
    setEditing(false);
    if (next === baseDir) {
      setDraft(baseDir);
      return;
    }

    setDraft(next);
    const ok = await persist(onSaveAppSettings, { baseDir: next }, reporter);
    if (!ok) {
      setDraft(baseDir);
    }
  }

  function cancelEdit(): void {
    cancelledRef.current = true;
    setPathError(null);
    setDraft(baseDir);
    setEditing(false);
  }

  async function handlePickFolder(): Promise<void> {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      const result = await selectFolder();
      const picked = result.selected ? result.path?.trim() : "";
      if (picked) {
        setPathError(null);
        setEditing(false);
        setDraft(picked);
        const ok = await persist(onSaveAppSettings, { baseDir: picked }, reporter);
        if (!ok) setDraft(baseDir);
      }
    } catch (error) {
      reporter?.reportError(errorMessage(error));
    } finally {
      setPickingFolder(false);
    }
  }

  async function handleToggleConfirm(next: boolean): Promise<void> {
    setConfirmDelete(next);
    const ok = await persist(onSaveAppSettings, { askDeleteCutConfirm: next }, reporter);
    if (!ok) setConfirmDelete(askDeleteCutConfirm);
  }

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SettingsSectionLabel>Pasta de armazenamento</SettingsSectionLabel>
        <div className={`${CARD_CLASS} flex items-center gap-4 px-4 py-3.5`}>
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item bg-glass-hover text-text-2"
          >
            <FolderOpen size={18} weight="regular" />
          </span>

          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                ref={inputRef}
                type="text"
                value={draft}
                spellCheck={false}
                aria-label="Pasta de armazenamento"
                aria-invalid={pathError ? true : undefined}
                aria-describedby={pathError ? "settings-base-dir-error" : undefined}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (pathError && event.target.value.trim()) setPathError(null);
                }}
                onBlur={() => {
                  if (cancelledRef.current) {
                    cancelledRef.current = false;
                    return;
                  }
                  if (!draft.trim()) {
                    // Valor vazio nunca é salvo: volta ao caminho ativo.
                    cancelEdit();
                    return;
                  }
                  void commitPath(draft);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitPath(draft);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelEdit();
                  }
                }}
                className="w-full rounded-sm border border-[rgba(91,156,255,0.55)] bg-transparent px-2 py-1 font-mono text-sm text-text-1 outline-none"
              />
            ) : (
              <button
                type="button"
                title="Clique para editar o caminho"
                onClick={() => {
                  cancelledRef.current = false;
                  setEditing(true);
                }}
                className="block max-w-full truncate rounded-sm text-left font-mono text-sm text-text-1 hover:text-accent-soft"
              >
                {baseDir || "—"}
              </button>
            )}
            {pathError ? (
              <p id="settings-base-dir-error" role="alert" className="mt-1 text-sm text-danger">
                {pathError}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-text-2">
                Onde ficam os vídeos, os cortes renderizados e as transcrições.
              </p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-text-3">
              <FolderSimple size={12} weight="regular" aria-hidden="true" />
              <span className="font-mono">
                Subpastas criadas automaticamente: videos/ · shorts/ · transcrições/
              </span>
            </p>
          </div>

          <GhostButton
            onClick={() => void handlePickFolder()}
            disabled={pickingFolder}
            leadingIcon={<FolderSimple size={14} weight="regular" />}
          >
            Alterar pasta
          </GhostButton>
        </div>
      </section>

      <section>
        <SettingsSectionLabel>Ao apagar um corte</SettingsSectionLabel>
        <div className={`${CARD_CLASS} flex items-center justify-between gap-4 px-4 py-3.5`}>
          <div className="min-w-0">
            <p id="settings-confirm-delete-title" className="text-base text-text-1">
              Confirmar antes de apagar um corte
            </p>
            <p id="settings-confirm-delete-desc" className="mt-0.5 text-sm text-text-2">
              Mostra uma confirmação antes de apagar um corte gerado ou editado.
            </p>
          </div>
          <SettingsSwitch
            checked={confirmDelete}
            onChange={(next) => void handleToggleConfirm(next)}
            ariaLabelledBy="settings-confirm-delete-title"
            ariaDescribedBy="settings-confirm-delete-desc"
          />
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 02 — Aplicação › Download                                              */
/* -------------------------------------------------------------------------- */

export interface AppDownloadSectionProps {
  downloadResolution: DownloadResolution;
  onSaveAppSettings: (patch: AppSettingsPatch) => void | Promise<void>;
  reporter?: AutoSaveReporter;
}

const RESOLUTION_OPTIONS: Array<{ value: DownloadResolution; title: string; subtitle: string }> = [
  { value: "1080p", title: "1080p Full HD", subtitle: "Padrão" },
  { value: "1440p", title: "1440p 2K", subtitle: "Alta fidelidade" },
  { value: "4k", title: "4K Ultra HD", subtitle: "Máxima" },
];

export function AppDownloadSection({
  downloadResolution,
  onSaveAppSettings,
  reporter,
}: AppDownloadSectionProps) {
  const [resolution, setResolution] = useState<DownloadResolution>(downloadResolution);

  useEffect(() => {
    setResolution(downloadResolution);
  }, [downloadResolution]);

  async function handleSelect(value: DownloadResolution): Promise<void> {
    if (value === resolution) return;
    setResolution(value);
    const ok = await persist(onSaveAppSettings, { downloadResolution: value }, reporter);
    if (!ok) setResolution(downloadResolution);
  }

  return (
    <section>
      <SettingsSectionLabel>Resolução do download</SettingsSectionLabel>
      <PickTileGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {RESOLUTION_OPTIONS.map((option) => (
          <PickTile
            key={option.value}
            selected={resolution === option.value}
            onSelect={() => void handleSelect(option.value)}
            actionLabel="Usar esta resolução"
            ariaLabel={`${option.title} — ${option.subtitle}`}
            className="min-h-[122px]"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-item bg-glass-hover text-text-2"
            >
              <Monitor size={16} weight="regular" />
            </span>
            <span className="mt-3 text-md text-text-1">{option.title}</span>
            <span className="text-sm text-text-3">{option.subtitle}</span>
          </PickTile>
        ))}
      </PickTileGroup>
      <p className="mt-3 text-sm text-text-3">Usada ao baixar vídeos do YouTube.</p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 03 — Dependências                                                      */
/* -------------------------------------------------------------------------- */

export interface DependencyStatus {
  installed: boolean;
  version: string | null;
}

interface DependencyInstallOptions {
  pytorchGpuTier?: PytorchGpuTier;
}

export interface DependenciesSectionProps {
  dependencies: Record<string, DependencyStatus> | null;
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

interface DependencyRowMeta {
  name: string;
  displayName: string;
  description: string;
  icon: ReactNode;
  autoInstall: boolean;
}

const DEPENDENCY_ROWS: DependencyRowMeta[] = [
  {
    name: "python",
    displayName: "Python",
    description: "Roda os scripts",
    icon: <Terminal size={16} weight="regular" />,
    autoInstall: true,
  },
  {
    name: "whisper",
    displayName: "Whisper",
    description: "Transcreve o áudio",
    icon: <Microphone size={16} weight="regular" />,
    autoInstall: true,
  },
  {
    name: "ytdlp",
    displayName: "yt-dlp",
    description: "Baixa os vídeos",
    icon: <DownloadSimple size={16} weight="regular" />,
    autoInstall: true,
  },
  {
    name: "ffmpeg",
    displayName: "FFmpeg",
    description: "Renderiza os cortes",
    icon: <FilmStrip size={16} weight="regular" />,
    autoInstall: true,
  },
  {
    name: "cuda",
    displayName: "CUDA",
    description: "Usa a placa de vídeo",
    icon: <Cpu size={16} weight="regular" />,
    autoInstall: false,
  },
  {
    name: "pytorch",
    displayName: "PyTorch",
    description: "Roda a IA na placa de vídeo",
    icon: <Brain size={16} weight="regular" />,
    autoInstall: true,
  },
  {
    name: "ollama",
    displayName: "Ollama",
    description: "Modelos de IA",
    icon: <Cube size={16} weight="regular" />,
    autoInstall: false,
  },
];

const TABLE_GRID =
  "grid grid-cols-[minmax(220px,1.7fr)_144px_144px_36px] items-stretch";
const CELL_DIVIDER = "border-r border-white/[0.06]";

const PYTORCH_TIERS: Array<{ value: PytorchGpuTier; label: string }> = [
  { value: "rtx_4000_or_lower", label: "RTX 4000 ou inferior" },
  { value: "rtx_5000", label: "RTX 5000" },
];

function readStoredTier(): PytorchGpuTier | null {
  try {
    const stored = window.localStorage.getItem("pytorchGpuTier");
    if (stored === "rtx_4000_or_lower" || stored === "rtx_5000") return stored;
  } catch {
    // ignore storage errors
  }
  return null;
}

function displayNameOf(name: string | null): string {
  if (!name) return "";
  return DEPENDENCY_ROWS.find((row) => row.name === name)?.displayName ?? name;
}

export function DependenciesSection({
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
  onRefresh,
  onShowInstallInstructions,
  onInstallDependency,
  onUninstallDependency,
  onCancelInstallSession,
  onDownloadInstallLogs,
}: DependenciesSectionProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [gpuChoiceOpen, setGpuChoiceOpen] = useState(false);
  const [storedTier, setStoredTier] = useState<PytorchGpuTier | null>(readStoredTier);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const menuCellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const logRef = useRef<HTMLPreElement>(null);

  const isLoadingInitial = !dependencies;
  const sessionRunning = installLogStatus === "running";
  const busy = Boolean(installingDependency || uninstallingDependency || sessionRunning);

  const isInstalled = (name: string): boolean => Boolean(dependencies?.[name]?.installed);
  const readyCount = DEPENDENCY_ROWS.filter((row) => isInstalled(row.name)).length;
  const total = DEPENDENCY_ROWS.length;
  const missing = DEPENDENCY_ROWS.filter((row) => !isInstalled(row.name));
  const nextInstallable = isLoadingInitial ? undefined : missing.find((row) => row.autoInstall);

  const ollamaOffline =
    isInstalled("ollama") &&
    (dependencies?.ollama?.version || "").toLowerCase().includes("server offline");

  // Fecha o popover ao clicar fora ou pressionar Escape.
  useEffect(() => {
    if (!openMenu) return;
    const activeMenu = openMenu;

    function handlePointerDown(event: Event): void {
      const activeCell = menuCellRefs.current[activeMenu];
      if (!activeCell || !activeCell.contains(event.target as Node)) {
        setOpenMenu(null);
        setConfirmUninstall(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
        setConfirmUninstall(null);
        requestAnimationFrame(() => menuTriggerRefs.current[activeMenu]?.focus());
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  // Foca o primeiro item ao abrir o popover.
  useEffect(() => {
    if (!openMenu) return;
    menuCellRefs.current[openMenu]?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [openMenu]);

  // Mantém o log rolado até o fim.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [installLogs, logsExpanded]);

  // Reabre o painel de logs quando uma nova operação começa.
  useEffect(() => {
    if (sessionRunning) setLogsExpanded(true);
  }, [sessionRunning, installSessionId]);

  function closeMenu(restoreFocusTo?: string): void {
    setOpenMenu(null);
    setConfirmUninstall(null);
    if (restoreFocusTo) {
      requestAnimationFrame(() => menuTriggerRefs.current[restoreFocusTo]?.focus());
    }
  }

  function startInstall(row: DependencyRowMeta): void {
    if (busy) return;
    if (row.name === "pytorch") {
      setGpuChoiceOpen(true);
      return;
    }
    void onInstallDependency(row.name, "logs");
  }

  function chooseTier(tier: PytorchGpuTier): void {
    setStoredTier(tier);
    try {
      window.localStorage.setItem("pytorchGpuTier", tier);
    } catch {
      // ignore storage errors
    }
    setGpuChoiceOpen(false);
    if (busy) return;
    void onInstallDependency("pytorch", "logs", { pytorchGpuTier: tier });
  }

  const hasLogPanel =
    Boolean(installLogDependency) &&
    (Boolean(installSessionId) || showInstallLogs || installLogs.length > 0);
  const hasResultMessage = Boolean(operationResultMessage);

  const resultColor =
    operationResultTone === "success"
      ? "text-success"
      : operationResultTone === "warning"
        ? "text-warning"
        : "text-danger";

  const logStatusLabel =
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
  const logStatusTone =
    installLogStatus === "success"
      ? "success"
      : installLogStatus === "failed"
        ? "danger"
        : installLogStatus === "running" || installLogStatus === "cancelled"
          ? "warning"
          : "neutral";

  const summaryText = isLoadingInitial
    ? "Verificando programas…"
    : missing.length === 0
      ? "Tudo pronto para usar."
      : missing.length <= 2
        ? `Falta instalar ${missing.map((row) => row.displayName).join(" e ")}.`
        : `Faltam ${missing.length} programas.`;

  return (
    <div className="flex flex-col gap-6">
      {/* Resumo: hairline + trilho azul de 2px à esquerda (sem glow, sem fundo azul forte). */}
      <div
        className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-glass px-5 py-4"
        style={{ boxShadow: "inset 2px 0 0 var(--accent-soft)" }}
      >
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-item bg-glass-hover text-accent-soft"
          >
            <Cpu size={22} weight="regular" />
          </span>
          <div>
            <p className="text-label font-medium uppercase tracking-[0.06em] text-accent-soft">
              Dependências
            </p>
            <p className="text-heading text-text-1 tabular-nums">
              {isLoadingInitial ? "—" : readyCount} de {total} prontas
            </p>
            <p className="text-sm text-text-3">{summaryText}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <GhostButton
            onClick={() => void onRefresh()}
            disabled={refreshingDependencies}
            leadingIcon={
              <ArrowsClockwise
                size={14}
                weight="regular"
                className={refreshingDependencies ? "animate-spin" : undefined}
              />
            }
          >
            Atualizar status
          </GhostButton>
          <GhostButton
            variant="accent"
            disabled={busy || !nextInstallable}
            onClick={() => nextInstallable && startInstall(nextInstallable)}
            leadingIcon={<DownloadSimple size={14} weight="regular" />}
          >
            Instalar o que falta
          </GhostButton>
        </div>
      </div>

      <section>
        <SettingsSectionLabel>Programas</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-glass">
          <div
            className={`${TABLE_GRID} border-b border-line px-4 py-2.5 text-label font-medium uppercase tracking-[0.06em] text-text-3`}
          >
            <span className="flex items-center justify-start pr-3">Programa</span>
            <span className="flex items-center justify-center px-3 text-center">Versão</span>
            <span className="flex items-center justify-center px-3 text-center">Status</span>
            <span aria-hidden="true" />
          </div>

          <ul>
            {DEPENDENCY_ROWS.map((row) => {
              const status = dependencies?.[row.name];
              const loading = isLoadingInitial || loadingDependencies.has(row.name);
              const installing = installingDependency === row.name;
              const uninstalling = uninstallingDependency === row.name;
              const installed = Boolean(status?.installed);
              const offline = row.name === "ollama" && ollamaOffline;
              const canUninstall = installed && row.autoInstall;
              const menuOpen = openMenu === row.name;

              let statusNode: ReactNode;
              if (installing) {
                statusNode = <span className="text-sm text-warning">Instalando…</span>;
              } else if (uninstalling) {
                statusNode = <span className="text-sm text-warning">Desinstalando…</span>;
              } else if (loading) {
                statusNode = <span className="text-sm text-text-3">Verificando…</span>;
              } else if (offline) {
                statusNode = <span className="text-sm text-warning">Servidor offline</span>;
              } else if (installed) {
                statusNode = <span className="text-sm text-success">Instalado</span>;
              } else {
                statusNode = (
                  <button
                    type="button"
                    disabled={busy && row.autoInstall}
                    aria-label={
                      row.autoInstall
                        ? `Instalar ${row.displayName}`
                        : `Como instalar ${row.displayName}`
                    }
                    onClick={() =>
                      row.autoInstall ? startInstall(row) : onShowInstallInstructions(row.name)
                    }
                    className="group/status cursor-pointer rounded-sm border-0 bg-transparent px-1 py-1 text-sm font-medium text-warning transition-[color,transform] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className="relative inline-grid place-items-center whitespace-nowrap [&>*]:col-start-1 [&>*]:row-start-1">
                      <span className="text-warning underline decoration-amber-400/45 decoration-dotted underline-offset-[5px] transition-[opacity,transform,color] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/status:-translate-y-1 group-hover/status:opacity-0 group-focus-visible/status:-translate-y-1 group-focus-visible/status:opacity-0">
                        Não instalado
                      </span>
                      <span className="translate-y-1 font-semibold text-[#7cb2ff] opacity-0 drop-shadow-[0_0_10px_rgba(91,156,255,0.45)] transition-[opacity,transform,color] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/status:translate-y-0 group-hover/status:opacity-100 group-focus-visible/status:translate-y-0 group-focus-visible/status:opacity-100">
                        {row.autoInstall ? "Instalar" : "Como instalar"}
                      </span>
                    </span>
                  </button>
                );
              }

              const version = !loading && installed && status?.version && !offline ? status.version : "—";

              return (
                <li
                  key={row.name}
                  className={`${TABLE_GRID} relative px-4 py-0`}
                >
                  <div className="flex min-w-0 items-center justify-start gap-3 py-2.5 pr-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item bg-glass-hover text-text-2"
                    >
                      {row.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base text-text-1">{row.displayName}</p>
                      <p className="truncate text-sm text-text-3">
                        {offline ? "Abra o app Ollama para ativar" : row.description}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`flex items-center justify-center px-3 py-2.5 text-center font-sans text-sm text-text-3 tabular-nums ${CELL_DIVIDER}`}
                  >
                    {version}
                  </span>
                  <div className="flex items-center justify-center px-3 py-2.5 text-center">
                    {statusNode}
                  </div>

                  <div
                    ref={(node) => {
                      menuCellRefs.current[row.name] = node;
                    }}
                    className="relative flex items-center justify-end py-2.5"
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        menuTriggerRefs.current[row.name] = node;
                      }}
                      aria-label={`Mais opções de ${row.displayName}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={() => {
                        setConfirmUninstall(null);
                        setOpenMenu(menuOpen ? null : row.name);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-pill text-text-3 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1"
                    >
                      <DotsThree size={18} weight="bold" />
                    </button>

                    {menuOpen && (
                      <div
                        role="menu"
                        aria-label={`Opções de ${row.displayName}`}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            closeMenu(row.name);
                          }
                        }}
                        className="glass--strong absolute right-0 top-full z-popover mt-1 min-w-[190px] rounded-card p-1"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeMenu();
                            onShowInstallInstructions(row.name);
                          }}
                          className="block w-full rounded-sm px-3 py-1.5 text-left text-sm text-text-1 hover:bg-glass-hover"
                        >
                          Ver instruções
                        </button>
                        {canUninstall && (
                          <button
                            type="button"
                            role="menuitem"
                            disabled={busy}
                            onClick={() => {
                              if (confirmUninstall !== row.name) {
                                setConfirmUninstall(row.name);
                                return;
                              }
                              closeMenu();
                              void onUninstallDependency(row.name, "logs");
                            }}
                            className="block w-full rounded-sm px-3 py-1.5 text-left text-sm text-danger hover:bg-danger-bg disabled:pointer-events-none disabled:opacity-50"
                          >
                            {confirmUninstall === row.name ? "Confirmar desinstalação" : "Desinstalar"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {row.name === "pytorch" && gpuChoiceOpen && (
                    <div className="col-span-full mt-2.5 flex flex-wrap items-center gap-2 rounded-card border border-line bg-glass-hover px-3 py-2.5">
                      <span className="mr-1 text-sm text-text-2">Qual é a sua placa de vídeo?</span>
                      {PYTORCH_TIERS.map((tier) => (
                        <GhostButton
                          key={tier.value}
                          variant={storedTier === tier.value ? "accent" : "default"}
                          className="h-7 px-3 text-xs"
                          onClick={() => chooseTier(tier.value)}
                        >
                          {tier.label}
                        </GhostButton>
                      ))}
                      <GhostButton
                        className="ml-auto h-7 border-transparent px-2 text-xs"
                        onClick={() => setGpuChoiceOpen(false)}
                      >
                        Cancelar
                      </GhostButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-3 text-sm text-text-3">
          Para usar a placa de vídeo, o driver da NVIDIA precisa estar instalado.
        </p>
      </section>

      {hasResultMessage && (
        <p role="status" className={`text-sm ${resultColor}`}>
          {operationResultMessage}
        </p>
      )}

      {hasLogPanel && (
        <section className="rounded-card border border-line bg-glass">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
            <button
              type="button"
              aria-expanded={logsExpanded}
              onClick={() => setLogsExpanded((value) => !value)}
              className="flex items-center gap-3 rounded-sm text-left"
            >
              <span className="text-base text-text-1">
                {installLogOperation === "uninstall" ? "Desinstalação" : "Instalação"} ·{" "}
                {displayNameOf(installLogDependency)}
              </span>
              <StatusDot tone={logStatusTone} label={logStatusLabel} />
            </button>
            <div className="flex items-center gap-2">
              {installLogs.length > 0 && (
                <GhostButton className="h-7 px-3 text-xs" onClick={onDownloadInstallLogs}>
                  Baixar logs
                </GhostButton>
              )}
              {installSessionId && sessionRunning && (
                <GhostButton
                  className="h-7 px-3 text-xs"
                  onClick={() => void onCancelInstallSession(installSessionId)}
                >
                  Cancelar
                </GhostButton>
              )}
            </div>
          </div>

          {logsExpanded && (
            <div className="border-t border-line px-4 py-3">
              {showInstallLogs ? (
                <pre
                  ref={logRef}
                  className="arc-scroll settings-scroll-fade m-0 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-[1.45] text-text-2"
                >
                  {installLogs.length === 0
                    ? "Aguardando logs da operação…"
                    : installLogs.join("\n")}
                </pre>
              ) : (
                <p className="text-sm text-text-3">
                  Acompanhamento configurado para o terminal do sistema.
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
