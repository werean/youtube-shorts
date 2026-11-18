import {
  ArrowCounterClockwise,
  BookmarkSimple,
  Cloud,
  Database,
  DotsThree,
  DownloadSimple,
  FloppyDisk,
  HardDrive,
  Info,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDefaultLLMPrompt,
  getSavedLLMPrompts,
  saveLLMPrompt,
  type SavedLLMPrompt,
} from "../../../api";
import {
  GhostButton,
  PickTile,
  PickTileGroup,
  SettingsSectionLabel,
  StatusDot,
  type AutoSaveReporter,
  type SectionId,
} from "./settingsShared";

/* -------------------------------------------------------------------------- */
/* Tipos Compartilhados                                                        */
/* -------------------------------------------------------------------------- */

export interface OllamaModelCatalogItem {
  name: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
}

export interface LLMAutoSavePatch {
  model?: string;
  system_prompt?: string;
  embedding_model?: string;
  registered_embedding_models?: string[];
}

export interface AIModelSectionProps {
  /** Modelo ativo do Ollama (aceita `llmModel` ou `model`). */
  llmModel?: string;
  model?: string;
  /** Modelo de embedding ativo (ex.: "nomic-embed-text"). */
  embeddingModel?: string;
  registeredEmbeddingModels?: string[];
  availableModels?: string[];
  modelCatalog?: OllamaModelCatalogItem[];
  /** Override opcional indicando se o embedding ativo já está baixado. */
  selectedEmbeddingDownloaded?: boolean;
  onSaveLLM: (patch: LLMAutoSavePatch) => Promise<void> | void;
  onRegisterModel: (
    name: string,
    source: "cloud" | "local",
  ) => Promise<{
    success: boolean;
    message: string;
    model: { name: string; source: "cloud" | "local" };
  }>;
  onRemoveModel: (name: string) => Promise<{ success: boolean; message: string }>;
  onRefreshModels: () => Promise<void>;
  onNavigateSection?: (section: SectionId) => void;
  reporter?: AutoSaveReporter;
}

export interface AISearchSectionProps {
  embeddingModel?: string;
  registeredEmbeddingModels?: string[];
  modelCatalog?: OllamaModelCatalogItem[];
  selectedEmbeddingDownloaded?: boolean;
  onSaveLLM: (patch: LLMAutoSavePatch) => Promise<void> | void;
  onRegisterModel?: (
    name: string,
    source: "cloud" | "local",
  ) => Promise<{
    success: boolean;
    message: string;
    model: { name: string; source: "cloud" | "local" };
  }>;
  onRefreshModels?: () => Promise<void>;
  reporter?: AutoSaveReporter;
}

export interface AIInstructionsSectionProps {
  /** System prompt atual da IA (aceita `llmSystemPrompt` ou `systemPrompt`). */
  llmSystemPrompt?: string;
  systemPrompt?: string;
  onSaveLLM: (patch: LLMAutoSavePatch) => Promise<void> | void;
  reporter?: AutoSaveReporter;
}

export type AISectionsProps = AIModelSectionProps &
  AISearchSectionProps &
  AIInstructionsSectionProps;

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

async function persistLLM(
  save: (patch: LLMAutoSavePatch) => Promise<void> | void,
  patch: LLMAutoSavePatch,
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

function normalizeUniqueNames(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = String(value || "").trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function isCloudModelName(name: string): boolean {
  return name.toLowerCase().includes("cloud");
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  const rounded = size >= 10 ? size.toFixed(0) : size.toFixed(1).replace(".", ",");
  return `${rounded} ${units[unit]}`;
}

function isEmbeddingInstalledInCatalog(
  targetModel: string,
  catalog: OllamaModelCatalogItem[],
  hints: string[] = [],
): boolean {
  const target = String(targetModel || "").trim().toLowerCase();
  if (!target) return false;

  if (hints.some((item) => item.toLowerCase() === target)) {
    return true;
  }

  return catalog.some((item) => {
    const catalogName = String(item?.name || "").trim().toLowerCase();
    if (!catalogName.startsWith(target)) return false;
    if (item.source === "cloud") return false;
    return Boolean(item.running || item.installed || !item.needsDownload);
  });
}

/* -------------------------------------------------------------------------- */
/* Tela 04 — IA e Modelos › Modelo (`ai-model`)                                */
/* -------------------------------------------------------------------------- */

export function AIModelSection({
  llmModel,
  model: modelProp,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  availableModels = [],
  modelCatalog = [],
  selectedEmbeddingDownloaded: selectedEmbeddingDownloadedProp,
  onSaveLLM,
  onRegisterModel,
  onRemoveModel,
  onRefreshModels,
  onNavigateSection,
  reporter,
}: AIModelSectionProps) {
  const initialModel = (llmModel ?? modelProp ?? "").trim();
  const [activeModel, setActiveModel] = useState<string>(initialModel);
  const [downloadedHints, setDownloadedHints] = useState<string[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [removingModel, setRemovingModel] = useState<string | null>(null);
  const [openMenuModel, setOpenMenuModel] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerSource, setRegisterSource] = useState<"local" | "cloud">("local");
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const menuCellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const menuTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = (llmModel ?? modelProp ?? "").trim();
    setActiveModel(next);
  }, [llmModel, modelProp]);

  useEffect(() => {
    if (showAddForm) {
      addInputRef.current?.focus();
    }
  }, [showAddForm]);

  useEffect(() => {
    if (!openMenuModel) return;
    const activeMenu = openMenuModel;

    function handlePointerDown(event: Event): void {
      const activeCell = menuCellRefs.current[activeMenu];
      if (!activeCell || !activeCell.contains(event.target as Node)) {
        setOpenMenuModel(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenuModel(null);
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
  }, [openMenuModel]);

  const modelOptions = useMemo(() => {
    const options = normalizeUniqueNames(availableModels);
    if (initialModel && !options.some((opt) => opt.toLowerCase() === initialModel.toLowerCase())) {
      options.unshift(initialModel);
    }
    return options;
  }, [availableModels, initialModel]);

  const orderedCatalog = useMemo(() => {
    const byName = new Map<string, OllamaModelCatalogItem>();

    for (const item of modelCatalog) {
      const name = String(item?.name || "").trim();
      if (!name) continue;
      const source: "cloud" | "local" =
        item.source === "cloud" || isCloudModelName(name) ? "cloud" : "local";
      const hintedDownload = downloadedHints.some(
        (h) => h.toLowerCase() === name.toLowerCase(),
      );
      byName.set(name, {
        ...item,
        name,
        source,
        installed: source === "cloud" ? false : Boolean(item.installed || hintedDownload),
        running: source === "cloud" ? false : Boolean(item.running),
        needsDownload:
          source === "cloud" ? false : hintedDownload ? false : Boolean(item.needsDownload),
      });
    }

    for (const name of modelOptions) {
      if (!byName.has(name)) {
        const cloud = isCloudModelName(name);
        const hintedDownload = downloadedHints.some(
          (h) => h.toLowerCase() === name.toLowerCase(),
        );
        byName.set(name, {
          name,
          source: cloud ? "cloud" : "local",
          installed: cloud ? false : true,
          running: false,
          needsDownload: cloud ? false : !hintedDownload,
        });
      }
    }

    return Array.from(byName.values()).sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [modelCatalog, modelOptions, downloadedHints]);

  const effectiveEmbeddingModel = (embeddingModel || DEFAULT_EMBEDDING_MODEL).trim();

  const selectedEmbeddingDownloaded = useMemo(() => {
    if (typeof selectedEmbeddingDownloadedProp === "boolean") {
      return selectedEmbeddingDownloadedProp;
    }
    return isEmbeddingInstalledInCatalog(
      effectiveEmbeddingModel,
      modelCatalog,
      downloadedHints,
    );
  }, [selectedEmbeddingDownloadedProp, effectiveEmbeddingModel, modelCatalog, downloadedHints]);

  async function handleSelectModel(name: string): Promise<void> {
    if (name === activeModel) return;
    const prev = activeModel;
    setActiveModel(name);
    const ok = await persistLLM(onSaveLLM, { model: name }, reporter);
    if (!ok) {
      setActiveModel(prev);
    }
  }

  async function handleDownloadModel(item: OllamaModelCatalogItem): Promise<void> {
    if (downloadingModel) return;
    setDownloadingModel(item.name);
    reporter?.reportSaving();
    try {
      await onRegisterModel(item.name, item.source);
      setDownloadedHints((prev) => normalizeUniqueNames([...prev, item.name]));
      await onRefreshModels();
      reporter?.reportSaved();
    } catch (error) {
      reporter?.reportError(errorMessage(error));
    } finally {
      setDownloadingModel(null);
    }
  }

  async function handleRemoveModel(name: string): Promise<void> {
    if (removingModel) return;
    setOpenMenuModel(null);
    setRemovingModel(name);
    reporter?.reportSaving();
    try {
      await onRemoveModel(name);
      await onRefreshModels();
      if (activeModel === name) {
        const fallback = orderedCatalog.find((entry) => entry.name !== name)?.name ?? "";
        setActiveModel(fallback);
        await onSaveLLM({ model: fallback });
      }
      reporter?.reportSaved();
    } catch (error) {
      reporter?.reportError(errorMessage(error));
    } finally {
      setRemovingModel(null);
    }
  }

  async function handleSubmitNewModel(): Promise<void> {
    const trimmed = registerName.trim();
    if (!trimmed || registerBusy) return;
    const inferredSource: "cloud" | "local" = isCloudModelName(trimmed)
      ? "cloud"
      : registerSource;

    setRegisterBusy(true);
    setRegisterError(null);
    reporter?.reportSaving();
    try {
      const result = await onRegisterModel(trimmed, inferredSource);
      const nextModelName = result?.model?.name || trimmed;
      setDownloadedHints((prev) => normalizeUniqueNames([...prev, nextModelName]));
      await onRefreshModels();
      setActiveModel(nextModelName);
      await onSaveLLM({ model: nextModelName });
      setRegisterName("");
      setShowAddForm(false);
      reporter?.reportSaved();
    } catch (error) {
      const msg = errorMessage(error) || "Falha ao adicionar o modelo.";
      setRegisterError(msg);
      reporter?.reportError(msg);
    } finally {
      setRegisterBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SettingsSectionLabel>MODELO DO OLLAMA</SettingsSectionLabel>

        <PickTileGroup className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {orderedCatalog.map((item) => {
            const isSelected = activeModel === item.name;
            const isCloud = item.source === "cloud";
            const needsDownload = !isCloud && item.needsDownload;
            const isDownloading = downloadingModel === item.name;
            const isRemoving = removingModel === item.name;
            const menuOpen = openMenuModel === item.name;
            const sizeFormatted = isCloud ? "" : formatSize(item.size);
            const description = isCloud
              ? "Roda na nuvem do Ollama. Precisa de internet e não usa a placa de vídeo."
              : sizeFormatted
                ? `Local · ${sizeFormatted}`
                : "Local";

            return (
              <PickTile
                key={item.name}
                selected={isSelected}
                onSelect={() => void handleSelectModel(item.name)}
                actionLabel={!needsDownload ? "Usar este modelo" : undefined}
                ariaLabel={`Selecionar modelo ${item.name}`}
                className="min-h-[178px]"
                topRightAction={
                  <div
                    ref={(node) => {
                      menuCellRefs.current[item.name] = node;
                    }}
                    className="pointer-events-auto relative z-10"
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        menuTriggerRefs.current[item.name] = node;
                      }}
                      aria-label={`Opções do modelo ${item.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      disabled={isRemoving}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenMenuModel(menuOpen ? null : item.name);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-pill text-text-3 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1"
                    >
                      <DotsThree size={16} weight="bold" />
                    </button>

                    {menuOpen && (
                      <div
                        role="menu"
                        aria-label={`Menu do modelo ${item.name}`}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenMenuModel(null);
                            requestAnimationFrame(() =>
                              menuTriggerRefs.current[item.name]?.focus(),
                            );
                          }
                        }}
                        className="glass--strong absolute right-0 top-full z-popover mt-1 min-w-[156px] rounded-card p-1"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isRemoving}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRemoveModel(item.name);
                          }}
                          className="block w-full rounded-sm px-3 py-1.5 text-left text-xs text-danger hover:bg-danger-bg disabled:opacity-50"
                        >
                          {isRemoving ? "Removendo…" : "Remover modelo"}
                        </button>
                      </div>
                    )}
                  </div>
                }
              >
                <span
                  aria-hidden="true"
                  className="w-8 h-8 rounded-lg bg-white/[0.04] border border-line grid place-items-center text-text-2"
                >
                  {isCloud ? <Cloud size={16} /> : <HardDrive size={16} />}
                </span>

                <span className="mt-3 font-mono text-sm font-medium text-text-1 break-all">
                  {item.name}
                </span>

                <span className="mt-1 text-xs text-text-2 leading-relaxed">
                  {description}
                </span>

                <div className="mt-auto pt-2.5">
                  {isCloud ? (
                    <StatusDot tone="cloud" label="Nuvem" className="text-xs" />
                  ) : needsDownload ? (
                    <StatusDot tone="warning" label="Precisa baixar" className="text-xs" />
                  ) : (
                    <StatusDot tone="success" label="Baixado" className="text-xs" />
                  )}
                </div>

                {needsDownload && (
                  <div className="mt-3 flex items-center gap-2 pointer-events-auto relative z-10">
                    <GhostButton
                      variant="accent"
                      className="pointer-events-auto relative z-10 h-7 px-3 text-xs"
                      disabled={isDownloading}
                      leadingIcon={
                        isDownloading ? (
                          <SpinnerGap size={13} className="animate-spin" />
                        ) : (
                          <DownloadSimple size={13} />
                        )
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownloadModel(item);
                      }}
                    >
                      {isDownloading ? "Baixando…" : "Baixar"}
                    </GhostButton>
                  </div>
                )}
              </PickTile>
            );
          })}
        </PickTileGroup>

        {/* Botão / painel tracejado para adicionar modelo */}
        <div className="mt-3">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => {
                setRegisterError(null);
                setRegisterName("");
                setRegisterSource("local");
                setShowAddForm(true);
              }}
              className="w-full border border-dashed border-line-strong rounded-card py-3 text-sm text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast flex items-center justify-center gap-1.5"
            >
              <span>+ Adicionar modelo</span>
            </button>
          ) : (
            <div className="w-full border border-dashed border-line-strong rounded-card p-4 bg-white/[0.015] space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <input
                  ref={addInputRef}
                  type="text"
                  value={registerName}
                  onChange={(event) => {
                    const val = event.target.value;
                    setRegisterName(val);
                    if (isCloudModelName(val)) {
                      setRegisterSource("cloud");
                    }
                    if (registerError) setRegisterError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSubmitNewModel();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setShowAddForm(false);
                    }
                  }}
                  placeholder="Nome do modelo (ex.: gemma3:12b ou qwen2.5:14b)"
                  aria-label="Nome do modelo do Ollama"
                  disabled={registerBusy}
                  className="flex-1 h-8 rounded-item border border-line-strong bg-glass px-3 font-sans text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent"
                />

                <select
                  aria-label="Origem do modelo"
                  value={registerSource}
                  disabled={registerBusy}
                  onChange={(event) =>
                    setRegisterSource(event.target.value as "local" | "cloud")
                  }
                  className="h-8 rounded-item border border-line-strong bg-bg-1 px-2.5 text-xs text-text-1 focus:outline-none focus:border-accent"
                >
                  <option value="local">Local</option>
                  <option value="cloud">Nuvem (Cloud)</option>
                </select>

                <div className="flex items-center gap-2 justify-end">
                  <GhostButton
                    onClick={() => {
                      setShowAddForm(false);
                      setRegisterError(null);
                    }}
                    disabled={registerBusy}
                    className="h-8 px-3 text-xs"
                  >
                    Cancelar
                  </GhostButton>
                  <GhostButton
                    variant="accent"
                    disabled={!registerName.trim() || registerBusy}
                    onClick={() => void handleSubmitNewModel()}
                    className="h-8 px-3 text-xs"
                  >
                    {registerBusy
                      ? "Verificando…"
                      : registerSource === "local"
                        ? "Baixar modelo"
                        : "Usar modelo"}
                  </GhostButton>
                </div>
              </div>

              {registerError && (
                <p role="alert" className="text-xs text-danger">
                  {registerError}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {!selectedEmbeddingDownloaded && (
        <div className="rounded-card border border-[rgba(245,158,11,0.35)] bg-warning-bg px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-text-1 min-w-0">
            <Info size={16} className="text-warning shrink-0" />
            <span className="truncate">
              Falta baixar <code className="font-mono">{effectiveEmbeddingModel}</code> para a busca por trechos.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateSection?.("ai-search")}
            className="text-xs font-medium text-accent-soft hover:underline shrink-0"
          >
            Ver busca por trechos
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 05 — IA e Modelos › Busca por trechos (`ai-search`)                    */
/* -------------------------------------------------------------------------- */

export function AISearchSection({
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  registeredEmbeddingModels = [],
  modelCatalog = [],
  selectedEmbeddingDownloaded: selectedEmbeddingDownloadedProp,
  onSaveLLM,
  onRegisterModel,
  onRefreshModels,
  reporter,
}: AISearchSectionProps) {
  const initialEmbedding = (embeddingModel || DEFAULT_EMBEDDING_MODEL).trim();
  const [activeEmbedding, setActiveEmbedding] = useState<string>(initialEmbedding);
  const [customModels, setCustomModels] = useState<string[]>(() =>
    normalizeUniqueNames(registeredEmbeddingModels),
  );
  const [downloadedHints, setDownloadedHints] = useState<string[]>([]);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newModelName, setNewModelName] = useState("");
  const [addingBusy, setAddingBusy] = useState(false);

  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveEmbedding((embeddingModel || DEFAULT_EMBEDDING_MODEL).trim());
  }, [embeddingModel]);

  useEffect(() => {
    setCustomModels((prev) =>
      normalizeUniqueNames([...prev, ...registeredEmbeddingModels]),
    );
  }, [registeredEmbeddingModels]);

  useEffect(() => {
    if (showAddForm) {
      addInputRef.current?.focus();
    }
  }, [showAddForm]);

  const embeddingList = useMemo(
    () =>
      normalizeUniqueNames([
        DEFAULT_EMBEDDING_MODEL,
        ...customModels,
        activeEmbedding,
      ]),
    [customModels, activeEmbedding],
  );

  function isModelDownloaded(name: string): boolean {
    if (
      typeof selectedEmbeddingDownloadedProp === "boolean" &&
      name.toLowerCase() === activeEmbedding.toLowerCase()
    ) {
      return (
        selectedEmbeddingDownloadedProp ||
        downloadedHints.some((h) => h.toLowerCase() === name.toLowerCase())
      );
    }
    return isEmbeddingInstalledInCatalog(name, modelCatalog, downloadedHints);
  }

  async function handleSelectEmbedding(name: string): Promise<void> {
    if (name === activeEmbedding) return;
    const prev = activeEmbedding;
    const nextRegistered = normalizeUniqueNames([...customModels, name]);
    setActiveEmbedding(name);
    setCustomModels(nextRegistered);
    const ok = await persistLLM(
      onSaveLLM,
      {
        embedding_model: name,
        registered_embedding_models: nextRegistered,
      },
      reporter,
    );
    if (!ok) {
      setActiveEmbedding(prev);
    }
  }

  async function handleDownloadEmbedding(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || downloadingModel) return;
    setDownloadingModel(trimmed);
    reporter?.reportSaving();
    try {
      if (onRegisterModel) {
        await onRegisterModel(trimmed, "local");
      } else {
        const response = await fetch("http://localhost:11434/api/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, stream: false }),
        });
        if (!response.ok) {
          throw new Error(`Falha ao baixar modelo (${response.status}).`);
        }
      }
      setDownloadedHints((prev) => normalizeUniqueNames([...prev, trimmed]));
      await onRefreshModels?.();
      reporter?.reportSaved();
    } catch (error) {
      reporter?.reportError(errorMessage(error));
    } finally {
      setDownloadingModel(null);
    }
  }

  async function handleAddEmbeddingModel(): Promise<void> {
    const nextName = newModelName.trim();
    if (!nextName || addingBusy) return;
    setAddingBusy(true);
    const nextRegistered = normalizeUniqueNames([...customModels, nextName]);
    setCustomModels(nextRegistered);
    setActiveEmbedding(nextName);
    setNewModelName("");
    setShowAddForm(false);

    try {
      await persistLLM(
        onSaveLLM,
        {
          embedding_model: nextName,
          registered_embedding_models: nextRegistered,
        },
        reporter,
      );
    } finally {
      setAddingBusy(false);
    }
  }

  return (
    <section>
      <SettingsSectionLabel>MODELO DE BUSCA</SettingsSectionLabel>

      <PickTileGroup className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {embeddingList.map((name) => {
          const isSelected = activeEmbedding.toLowerCase() === name.toLowerCase();
          const downloaded = isModelDownloaded(name);
          const isDownloading = downloadingModel === name;
          const description =
            name.toLowerCase() === DEFAULT_EMBEDDING_MODEL
              ? "Ajuda a achar partes do vídeo sobre o mesmo assunto."
              : "Ajuda a achar partes do vídeo sobre o mesmo assunto.";

          return (
            <PickTile
              key={name}
              selected={isSelected}
              onSelect={() => void handleSelectEmbedding(name)}
              actionLabel={downloaded && !isSelected ? "Usar este modelo" : undefined}
              ariaLabel={`Selecionar modelo de busca ${name}`}
              className="min-h-[172px]"
            >
              <span
                aria-hidden="true"
                className="w-8 h-8 rounded-lg bg-white/[0.04] border border-line grid place-items-center text-text-2"
              >
                <Database size={16} />
              </span>

              <span className="mt-3 font-mono text-sm font-medium text-text-1 break-all">
                {name}
              </span>

              <span className="mt-1 text-xs text-text-2 leading-relaxed">
                {description}
              </span>

              <div className="mt-auto pt-2.5">
                {downloaded ? (
                  <StatusDot tone="success" label="Baixado" className="text-xs" />
                ) : (
                  <StatusDot tone="warning" label="Modelo não baixado" className="text-xs" />
                )}
              </div>

              {!downloaded && (
                <div className="mt-3 flex items-center gap-2 pointer-events-auto relative z-10">
                  <GhostButton
                    variant="accent"
                    className="pointer-events-auto relative z-10 h-7 px-3 text-xs"
                    disabled={isDownloading}
                    leadingIcon={
                      isDownloading ? (
                        <SpinnerGap size={13} className="animate-spin" />
                      ) : (
                        <DownloadSimple size={13} />
                      )
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownloadEmbedding(name);
                    }}
                  >
                    {isDownloading ? "Baixando…" : "Baixar modelo"}
                  </GhostButton>

                  {!isSelected && (
                    <GhostButton
                      className="pointer-events-auto relative z-10 h-7 px-3 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleSelectEmbedding(name);
                      }}
                    >
                      Usar este modelo
                    </GhostButton>
                  )}
                </div>
              )}
            </PickTile>
          );
        })}

        {/* Card tracejado "+ Adicionar modelo" na segunda coluna */}
        {!showAddForm ? (
          <button
            type="button"
            onClick={() => {
              setNewModelName("");
              setShowAddForm(true);
            }}
            className="min-h-[172px] border border-dashed border-line-strong rounded-card p-4 text-sm text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast flex items-center justify-center gap-1.5"
          >
            <span>+ Adicionar modelo</span>
          </button>
        ) : (
          <div className="min-h-[172px] border border-dashed border-line-strong rounded-card p-4 bg-white/[0.015] flex flex-col justify-between gap-3">
            <div className="space-y-2">
              <label
                htmlFor="settings-embedding-add-input"
                className="block text-xs font-medium text-text-2"
              >
                Nome do modelo de busca
              </label>
              <input
                id="settings-embedding-add-input"
                ref={addInputRef}
                type="text"
                value={newModelName}
                onChange={(event) => setNewModelName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleAddEmbeddingModel();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setShowAddForm(false);
                  }
                }}
                placeholder="Ex.: nomic-embed-text"
                disabled={addingBusy}
                className="w-full h-8 rounded-item border border-line-strong bg-glass px-3 font-sans text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <GhostButton
                onClick={() => setShowAddForm(false)}
                disabled={addingBusy}
                className="h-7 px-3 text-xs"
              >
                Cancelar
              </GhostButton>
              <GhostButton
                variant="accent"
                disabled={!newModelName.trim() || addingBusy}
                onClick={() => void handleAddEmbeddingModel()}
                className="h-7 px-3 text-xs"
              >
                Adicionar modelo
              </GhostButton>
            </div>
          </div>
        )}
      </PickTileGroup>

      <p className="mt-3 text-xs text-text-2">
        Para adicionar outro modelo, informe o nome exato dele (por exemplo, nomic-embed-text).
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 06 — IA e Modelos › Instruções (`ai-instructions`)                     */
/* -------------------------------------------------------------------------- */

export function AIInstructionsSection({
  llmSystemPrompt,
  systemPrompt: systemPromptProp,
  onSaveLLM,
  reporter,
}: AIInstructionsSectionProps) {
  const incomingPrompt = llmSystemPrompt ?? systemPromptProp ?? "";
  const [localPrompt, setLocalPrompt] = useState<string>(incomingPrompt);
  const [restoringDefault, setRestoringDefault] = useState(false);

  // Estado para "Prompts salvos" e "Salvar com nome"
  const [showSavedDrawer, setShowSavedDrawer] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedLLMPrompt[]>([]);
  const [loadingSavedPrompts, setLoadingSavedPrompts] = useState(false);
  const [savedPromptsError, setSavedPromptsError] = useState<string | null>(null);

  const [showSaveNameRow, setShowSaveNameRow] = useState(false);
  const [promptName, setPromptName] = useState("");
  const [savingNamedPrompt, setSavingNamedPrompt] = useState(false);
  const [saveNamedError, setSaveNamedError] = useState<string | null>(null);

  const latestDraftRef = useRef<string>(incomingPrompt);
  const lastSavedRef = useRef<string>(incomingPrompt);
  const dirtyRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSaveLLM);
  const reporterRef = useRef(reporter);
  const nameInputRef = useRef<HTMLInputElement>(null);

  onSaveRef.current = onSaveLLM;
  reporterRef.current = reporter;

  // Sincroniza quando o prompt externo muda e não há edição local pendente
  useEffect(() => {
    if (!dirtyRef.current && incomingPrompt !== lastSavedRef.current) {
      setLocalPrompt(incomingPrompt);
      latestDraftRef.current = incomingPrompt;
      lastSavedRef.current = incomingPrompt;
    }
  }, [incomingPrompt]);

  useEffect(() => {
    if (showSaveNameRow) {
      nameInputRef.current?.focus();
    }
  }, [showSaveNameRow]);

  async function flushPromptSave(nextValue: string): Promise<void> {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!dirtyRef.current && nextValue === lastSavedRef.current) {
      return;
    }
    dirtyRef.current = false;
    lastSavedRef.current = nextValue;
    await persistLLM(onSaveRef.current, { system_prompt: nextValue }, reporterRef.current);
  }

  // Flush imediato ao desmontar se houver rascunho sujo
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        const pending = latestDraftRef.current;
        lastSavedRef.current = pending;
        void persistLLM(onSaveRef.current, { system_prompt: pending }, reporterRef.current);
      }
    };
  }, []);

  function handlePromptChange(nextValue: string): void {
    setLocalPrompt(nextValue);
    latestDraftRef.current = nextValue;
    dirtyRef.current = nextValue !== lastSavedRef.current;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (dirtyRef.current) {
      debounceTimerRef.current = setTimeout(() => {
        void flushPromptSave(latestDraftRef.current);
      }, 500);
    }
  }

  async function handleToggleSavedPrompts(): Promise<void> {
    const nextOpen = !showSavedDrawer;
    setShowSavedDrawer(nextOpen);
    setShowSaveNameRow(false);
    setSavedPromptsError(null);

    if (nextOpen) {
      setLoadingSavedPrompts(true);
      try {
        const response = await getSavedLLMPrompts();
        setSavedPrompts(Array.isArray(response?.prompts) ? response.prompts : []);
      } catch (error) {
        setSavedPromptsError(errorMessage(error) || "Falha ao carregar prompts salvos.");
      } finally {
        setLoadingSavedPrompts(false);
      }
    }
  }

  async function handleSelectSavedPrompt(item: SavedLLMPrompt): Promise<void> {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setLocalPrompt(item.prompt);
    latestDraftRef.current = item.prompt;
    dirtyRef.current = false;
    lastSavedRef.current = item.prompt;
    setShowSavedDrawer(false);
    await persistLLM(onSaveLLM, { system_prompt: item.prompt }, reporter);
  }

  async function handleSaveWithName(): Promise<void> {
    const trimmedName = promptName.trim();
    const trimmedPrompt = localPrompt.trim();
    if (!trimmedName) {
      setSaveNamedError("Informe um nome para o prompt.");
      return;
    }
    if (!trimmedPrompt) {
      setSaveNamedError("O prompt atual está vazio.");
      return;
    }

    setSavingNamedPrompt(true);
    setSaveNamedError(null);
    reporter?.reportSaving();
    try {
      const response = await saveLLMPrompt({
        name: trimmedName,
        prompt: localPrompt,
      });
      if (Array.isArray(response?.prompts)) {
        setSavedPrompts(response.prompts);
      }
      setPromptName("");
      setShowSaveNameRow(false);
      reporter?.reportSaved();
    } catch (error) {
      const msg = errorMessage(error) || "Falha ao salvar o prompt.";
      setSaveNamedError(msg);
      reporter?.reportError(msg);
    } finally {
      setSavingNamedPrompt(false);
    }
  }

  async function handleRestoreDefault(): Promise<void> {
    if (restoringDefault) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setRestoringDefault(true);
    reporter?.reportSaving();
    try {
      const response = await getDefaultLLMPrompt();
      const defaultText = response?.prompt ?? "";
      setLocalPrompt(defaultText);
      latestDraftRef.current = defaultText;
      lastSavedRef.current = defaultText;
      dirtyRef.current = false;
      await onSaveLLM({ system_prompt: defaultText });
      reporter?.reportSaved();
    } catch (error) {
      reporter?.reportError(errorMessage(error));
    } finally {
      setRestoringDefault(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <SettingsSectionLabel className="mb-0">INSTRUÇÕES DA IA</SettingsSectionLabel>

        <div className="flex items-center gap-2">
          <GhostButton
            leadingIcon={<BookmarkSimple size={14} />}
            onClick={() => void handleToggleSavedPrompts()}
          >
            Prompts salvos
          </GhostButton>
          <GhostButton
            leadingIcon={<FloppyDisk size={14} />}
            onClick={() => {
              setSaveNamedError(null);
              setPromptName("");
              setShowSavedDrawer(false);
              setShowSaveNameRow((prev) => !prev);
            }}
          >
            Salvar com nome
          </GhostButton>
        </div>
      </div>

      {/* Painel inline: Salvar com nome */}
      {showSaveNameRow && (
        <div className="mb-3 rounded-card border border-line bg-glass p-3 space-y-2">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              ref={nameInputRef}
              type="text"
              value={promptName}
              onChange={(event) => {
                setPromptName(event.target.value);
                if (saveNamedError) setSaveNamedError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSaveWithName();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setShowSaveNameRow(false);
                }
              }}
              placeholder="Nome do prompt (ex.: Storytelling dinâmico)"
              aria-label="Nome do prompt"
              disabled={savingNamedPrompt}
              className="flex-1 h-8 rounded-item border border-line-strong bg-white/[0.03] px-3 font-sans text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent"
            />
            <div className="flex items-center justify-end gap-2">
              <GhostButton
                onClick={() => setShowSaveNameRow(false)}
                disabled={savingNamedPrompt}
                className="h-8 px-3 text-xs"
              >
                Cancelar
              </GhostButton>
              <GhostButton
                variant="accent"
                disabled={!promptName.trim() || savingNamedPrompt}
                onClick={() => void handleSaveWithName()}
                className="h-8 px-3 text-xs"
              >
                {savingNamedPrompt ? "Salvando…" : "Salvar"}
              </GhostButton>
            </div>
          </div>
          {saveNamedError && (
            <p role="alert" className="text-xs text-danger">
              {saveNamedError}
            </p>
          )}
        </div>
      )}

      {/* Drawer / lista inline: Prompts salvos */}
      {showSavedDrawer && (
        <div className="mb-3 rounded-card border border-line bg-glass p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-2">
              Selecione um prompt salvo para carregar
            </span>
            <button
              type="button"
              aria-label="Fechar prompts salvos"
              onClick={() => setShowSavedDrawer(false)}
              className="flex h-6 w-6 items-center justify-center rounded-pill text-text-3 hover:bg-glass-hover hover:text-text-1"
            >
              <X size={13} />
            </button>
          </div>

          {loadingSavedPrompts ? (
            <p className="text-xs text-text-3 py-2">Carregando prompts salvos…</p>
          ) : savedPromptsError ? (
            <p role="alert" className="text-xs text-danger py-1">
              {savedPromptsError}
            </p>
          ) : savedPrompts.length === 0 ? (
            <p className="text-xs text-text-3 py-2">Ainda não existem prompts salvos.</p>
          ) : (
            <ul className="divide-y divide-line max-h-[180px] overflow-y-auto arc-scroll">
              {savedPrompts.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelectSavedPrompt(item)}
                    className="w-full flex items-center justify-between gap-3 px-2.5 py-2 text-left rounded-sm hover:bg-glass-hover transition-colors duration-fast"
                  >
                    <span className="text-xs font-medium text-text-1 truncate">
                      {item.name}
                    </span>
                    <span className="text-xs text-accent-soft shrink-0">Carregar</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Card único com textarea */}
      <div className="rounded-card border border-line bg-white/[0.015] relative overflow-hidden">
        <textarea
          value={localPrompt}
          onChange={(event) => handlePromptChange(event.target.value)}
          onBlur={() => {
            if (dirtyRef.current) {
              void flushPromptSave(latestDraftRef.current);
            }
          }}
          aria-label="Instruções da IA"
          spellCheck={false}
          className="w-full h-[360px] resize-none bg-transparent p-4 font-sans text-sm leading-relaxed text-text-1 focus:outline-none settings-scroll-fade arc-scroll"
        />
      </div>

      {/* Linha inferior: Restaurar padrão + texto auxiliar */}
      <div className="mt-4 flex items-center gap-4 flex-wrap">
        <GhostButton
          leadingIcon={<ArrowCounterClockwise size={14} />}
          disabled={restoringDefault}
          onClick={() => void handleRestoreDefault()}
        >
          Restaurar padrão
        </GhostButton>
        <p className="text-xs text-text-2">
          Define como a IA escolhe e nomeia os cortes. Ao restaurar, o texto atual é substituído pela versão padrão.
        </p>
      </div>
    </section>
  );
}
