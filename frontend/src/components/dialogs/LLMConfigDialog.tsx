import { useEffect, useMemo, useState } from "react";
import type { ActionState } from "../../hooks/useAppAction";
import {
  getDefaultLLMPrompt,
  getSavedLLMPrompts,
  saveLLMPrompt,
  type SavedLLMPrompt,
} from "../../api";
import { AppButton, AppInput, AppSelect } from "../shared";

interface OllamaModelCatalogItem {
  name: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
}

interface LLMConfigDialogProps {
  llmModel: string;
  embeddingModel: string;
  registeredEmbeddingModels?: string[];
  availableModels: string[];
  modelCatalog?: OllamaModelCatalogItem[];
  localAvailable?: boolean;
  remoteAvailable?: boolean;
  llmSystemPrompt: string;
  action: ActionState;
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
  onSave: (
    model: string,
    prompt: string,
    embeddingModel: string,
    registeredEmbeddingModels: string[],
  ) => void;
  onCancel: () => void;
}

type ModelFilter = "all" | "cloud" | "local";
type RegisterStep = "form" | "verifying" | "success" | "error";

const DEFAULT_EMBEDDING_MODELS = [
  "nomic-embed-text",
  "embeddinggemma",
  "qwen3-embedding",
  "all-minilm",
];

function normalizeUniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = String(value || "").trim();
    if (!next) {
      continue;
    }

    const key = next.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function isCloudModelName(name: string): boolean {
  return name.toLowerCase().includes("cloud");
}

function formatDisplayModelName(name: string, source: "cloud" | "local"): string {
  if (source !== "cloud") {
    return name;
  }

  return name.toLowerCase().includes("-cloud") ? name : `${name} -cloud`;
}

export function LLMConfigDialog({
  llmModel: initialModel,
  embeddingModel: initialEmbeddingModel,
  registeredEmbeddingModels = [],
  availableModels,
  modelCatalog = [],
  llmSystemPrompt: initialPrompt,
  action,
  onRegisterModel,
  onRemoveModel,
  onRefreshModels,
  onSave,
  onCancel,
}: LLMConfigDialogProps) {
  const [model, setModel] = useState(initialModel);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(
    initialEmbeddingModel || DEFAULT_EMBEDDING_MODELS[0],
  );
  const [customEmbeddingModels, setCustomEmbeddingModels] = useState<string[]>(() =>
    normalizeUniqueNames(
      registeredEmbeddingModels.filter(
        (item) =>
          !DEFAULT_EMBEDDING_MODELS.some(
            (defaultModel) => defaultModel.toLowerCase() === item.toLowerCase(),
          ),
      ),
    ),
  );
  const [showEmbeddingRegisterForm, setShowEmbeddingRegisterForm] = useState(false);
  const [embeddingRegisterName, setEmbeddingRegisterName] = useState("");
  const [isDownloadingEmbedding, setIsDownloadingEmbedding] = useState(false);
  const [downloadedEmbeddingHints, setDownloadedEmbeddingHints] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerSource, setRegisterSource] = useState<"" | "cloud" | "local">("");
  const [registerStep, setRegisterStep] = useState<RegisterStep>("form");
  const [registerMessage, setRegisterMessage] = useState("");
  const [removingModelName, setRemovingModelName] = useState<string | null>(null);
  const [showResetPromptDialog, setShowResetPromptDialog] = useState(false);
  const [isResettingPrompt, setIsResettingPrompt] = useState(false);
  const [resetPromptError, setResetPromptError] = useState<string | null>(null);
  const [savedPrompts, setSavedPrompts] = useState<SavedLLMPrompt[]>([]);
  const [showSavePromptDialog, setShowSavePromptDialog] = useState(false);
  const [showSavedPromptsDialog, setShowSavedPromptsDialog] = useState(false);
  const [newPromptName, setNewPromptName] = useState("");
  const [selectedSavedPromptId, setSelectedSavedPromptId] = useState<string | null>(null);
  const [expandedSavedPromptId, setExpandedSavedPromptId] = useState<string | null>(null);
  const [savedPromptFeedback, setSavedPromptFeedback] = useState<string | null>(null);
  const [isLoadingSavedPrompts, setIsLoadingSavedPrompts] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  const modelOptions = useMemo(() => {
    const options = Array.from(new Set(availableModels.map((item) => item.trim()).filter(Boolean)));

    if (initialModel && !options.includes(initialModel)) {
      options.unshift(initialModel);
    }

    return options;
  }, [availableModels, initialModel]);

  const catalogByName = useMemo(() => {
    const next = new Map<string, OllamaModelCatalogItem>();
    for (const item of modelCatalog) {
      const name = String(item?.name || "").trim();
      if (!name) {
        continue;
      }

      const normalizedSource: "cloud" | "local" = isCloudModelName(name) ? "cloud" : "local";

      next.set(name, {
        ...item,
        source: normalizedSource,
        installed: normalizedSource === "cloud" ? false : item.installed,
        running: normalizedSource === "cloud" ? false : item.running,
        needsDownload: normalizedSource === "cloud" ? false : item.needsDownload,
      });
    }
    return next;
  }, [modelCatalog]);

  const orderedCatalog = useMemo(() => {
    const fromCatalog = Array.from(catalogByName.values());
    const known = new Set(fromCatalog.map((item) => item.name));

    for (const name of modelOptions) {
      if (!known.has(name)) {
        const cloudModel = isCloudModelName(name);
        fromCatalog.push({
          name,
          source: cloudModel ? "cloud" : "local",
          installed: cloudModel ? false : true,
          running: false,
          needsDownload: cloudModel ? false : true,
        });
      }
    }

    return fromCatalog.sort((a, b) => {
      if (a.name === model) return -1;
      if (b.name === model) return 1;
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [catalogByName, modelOptions, model]);

  const filteredCatalog = useMemo(() => {
    return orderedCatalog.filter((item) => {
      if (modelFilter === "cloud") {
        return item.source === "cloud";
      }
      if (modelFilter === "local") {
        return item.source === "local";
      }
      return true;
    });
  }, [orderedCatalog, modelFilter]);

  const embeddingModelOptions = useMemo(
    () =>
      normalizeUniqueNames([
        ...DEFAULT_EMBEDDING_MODELS,
        ...customEmbeddingModels,
        initialEmbeddingModel,
        selectedEmbeddingModel,
      ]),
    [customEmbeddingModels, initialEmbeddingModel, selectedEmbeddingModel],
  );

  const selectedEmbeddingDownloaded = useMemo(() => {
    const target = String(selectedEmbeddingModel || "")
      .trim()
      .toLowerCase();
    if (!target) {
      return false;
    }

    if (downloadedEmbeddingHints.some((item) => item.toLowerCase() === target)) {
      return true;
    }

    return modelCatalog.some((item) => {
      const catalogName = String(item?.name || "")
        .trim()
        .toLowerCase();
      if (!catalogName.startsWith(target)) {
        return false;
      }

      if (item.source === "cloud") {
        return false;
      }

      return item.running || item.installed || !item.needsDownload;
    });
  }, [selectedEmbeddingModel, downloadedEmbeddingHints, modelCatalog]);

  function formatSize(bytes?: number): string {
    if (!bytes || bytes <= 0) {
      return "";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }

    const rounded = size >= 10 ? size.toFixed(0) : size.toFixed(1);
    return `${rounded} ${units[unit]}`;
  }

  function buildOptionLabel(option: string): string {
    const item = catalogByName.get(option);
    if (!item) {
      return isCloudModelName(option) ? `${option} -cloud • cloud` : `${option} • local`;
    }

    if (item.source === "cloud") {
      return `${formatDisplayModelName(option, "cloud")} • cloud`;
    }

    if (item.running) {
      return `${option} • local (em execução)`;
    }

    if (item.installed) {
      return `${option} • local (baixado)`;
    }

    return `${option} • local (não baixado)`;
  }

  function openRegisterModelForm() {
    setShowRegisterForm(true);
    setRegisterName("");
    setRegisterSource("");
    setRegisterStep("form");
    setRegisterMessage("");
  }

  function openEmbeddingRegisterForm() {
    setShowEmbeddingRegisterForm(true);
    setEmbeddingRegisterName("");
  }

  async function handleRegisterModel() {
    const nextName = registerName.trim();
    if (!nextName || !registerSource) {
      return;
    }

    setRegisterStep("verifying");
    setRegisterMessage("");

    try {
      const result = await onRegisterModel(nextName, registerSource);
      await onRefreshModels();
      setModel(result.model.name);
      setRegisterMessage(result.message || "Modelo cadastrado e validado com sucesso.");
      setRegisterStep("success");
    } catch (error: any) {
      setRegisterMessage(String(error?.message || "Falha ao cadastrar ou verificar o modelo."));
      setRegisterStep("error");
    }
  }

  function handleAddEmbeddingModel() {
    const nextName = embeddingRegisterName.trim();
    if (!nextName) {
      return;
    }

    setCustomEmbeddingModels((prev) => normalizeUniqueNames([...prev, nextName]));
    setSelectedEmbeddingModel(nextName);
    setShowEmbeddingRegisterForm(false);
    setEmbeddingRegisterName("");
  }

  async function handleDownloadEmbeddingModel() {
    const nextModel = selectedEmbeddingModel.trim();
    if (!nextModel) {
      return;
    }

    setIsDownloadingEmbedding(true);
    try {
      const response = await fetch("http://localhost:11434/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextModel,
          stream: false,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        let detail = text.trim();

        if (text) {
          try {
            const payload = JSON.parse(text) as {
              error?: unknown;
              message?: unknown;
              detail?: unknown;
            };
            detail = String(payload.error || payload.message || payload.detail || text).trim();
          } catch {
            detail = text.trim();
          }
        }

        throw new Error(detail || `Falha ao baixar modelo (${response.status}).`);
      }

      setDownloadedEmbeddingHints((prev) => normalizeUniqueNames([...prev, nextModel]));
      await onRefreshModels();
    } catch (error: any) {
      alert(String(error?.message || "Falha ao baixar o modelo de embedding."));
    } finally {
      setIsDownloadingEmbedding(false);
    }
  }

  async function handleRemoveModel(name: string) {
    const confirmDelete = window.confirm(
      `Deseja remover o modelo '${name}'? Isso tenta executar 'ollama rm ${name}'.`,
    );
    if (!confirmDelete) {
      return;
    }

    setRemovingModelName(name);
    try {
      const result = await onRemoveModel(name);
      await onRefreshModels();
      if (model === name) {
        setModel("");
      }
      alert(result.message || "Modelo removido.");
    } catch (error: any) {
      alert(String(error?.message || "Falha ao remover o modelo."));
    } finally {
      setRemovingModelName(null);
    }
  }

  async function handleResetPrompt() {
    setIsResettingPrompt(true);
    setResetPromptError(null);
    try {
      const response = await getDefaultLLMPrompt();
      setPrompt(response.prompt || "");
      setShowResetPromptDialog(false);
    } catch (error: any) {
      setResetPromptError(String(error?.message || "Falha ao carregar o prompt padrão."));
    } finally {
      setIsResettingPrompt(false);
    }
  }

  async function loadSavedPromptsList() {
    setIsLoadingSavedPrompts(true);
    setSavedPromptFeedback(null);
    try {
      const response = await getSavedLLMPrompts();
      const nextPrompts = Array.isArray(response.prompts) ? response.prompts : [];
      setSavedPrompts(nextPrompts);
      if (nextPrompts.length === 0) {
        setSelectedSavedPromptId(null);
      }
    } catch (error: any) {
      setSavedPromptFeedback(String(error?.message || "Falha ao carregar prompts salvos."));
    } finally {
      setIsLoadingSavedPrompts(false);
    }
  }

  async function handleOpenSavedPromptsDialog() {
    setSelectedSavedPromptId(null);
    setExpandedSavedPromptId(null);
    setShowSavedPromptsDialog(true);
    await loadSavedPromptsList();
  }

  async function handleSaveCurrentPrompt() {
    const name = newPromptName.trim();
    if (!name) {
      setSavedPromptFeedback("Informe um nome para o prompt.");
      return;
    }

    const currentPrompt = prompt.trim();
    if (!currentPrompt) {
      setSavedPromptFeedback("O prompt atual está vazio e não pode ser salvo.");
      return;
    }

    setIsSavingPrompt(true);
    setSavedPromptFeedback(null);
    try {
      const response = await saveLLMPrompt({
        name,
        prompt: currentPrompt,
      });
      const nextPrompts = Array.isArray(response.prompts) ? response.prompts : [];
      setSavedPrompts(nextPrompts);
      setShowSavePromptDialog(false);
      setNewPromptName("");
    } catch (error: any) {
      setSavedPromptFeedback(String(error?.message || "Falha ao salvar o prompt."));
    } finally {
      setIsSavingPrompt(false);
    }
  }

  function handleApplySavedPrompt() {
    const selected = savedPrompts.find((item) => item.id === selectedSavedPromptId);
    if (!selected) {
      setSavedPromptFeedback("Selecione um prompt salvo para continuar.");
      return;
    }

    setPrompt(selected.prompt);
    setShowSavedPromptsDialog(false);
    setSavedPromptFeedback(null);
  }

  useEffect(() => {
    void loadSavedPromptsList();
  }, []);

  useEffect(() => {
    if (!model && modelOptions.length > 0) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions]);

  useEffect(() => {
    if (!selectedEmbeddingModel && embeddingModelOptions.length > 0) {
      setSelectedEmbeddingModel(embeddingModelOptions[0]);
    }
  }, [selectedEmbeddingModel, embeddingModelOptions]);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <div className="dialog-header">
          <h3>Configurar LLM</h3>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          <div style={{ marginBottom: "14px" }}>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              Modelo do Ollama
            </label>
            <AppSelect
              value={model}
              onChange={(e) => setModel(e.target.value)}
              fullWidth
              style={{
                padding: "10px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                backgroundColor: "var(--bg-contrast)",
                color: "var(--ink)",
              }}
            >
              {modelOptions.length === 0 ? (
                <option value="">Nenhum modelo detectado</option>
              ) : (
                modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {buildOptionLabel(option)}
                  </option>
                ))
              )}
            </AppSelect>

            <div
              style={{
                marginTop: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(
                  [
                    { key: "all", label: "Todos" },
                    { key: "cloud", label: "Cloud" },
                    { key: "local", label: "Modelos locais" },
                  ] as Array<{ key: ModelFilter; label: string }>
                ).map((filter) => {
                  const active = modelFilter === filter.key;
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setModelFilter(filter.key)}
                      style={{
                        fontSize: "11px",
                        borderRadius: "999px",
                        border: `1px solid ${active ? "var(--accent-2)" : "var(--border)"}`,
                        padding: "2px 8px",
                        color: active ? "var(--accent-2)" : "var(--muted)",
                        background: active ? "var(--bg-3)" : "var(--bg-contrast)",
                      }}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
              <AppButton
                type="button"
                variant="primary"
                onClick={openRegisterModelForm}
                style={{ padding: "8px 12px", fontSize: "12px" }}
              >
                Adicionar modelo
              </AppButton>
            </div>

            {filteredCatalog.length > 0 && (
              <div
                style={{
                  marginTop: "10px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  maxHeight: "220px",
                  overflowY: "auto",
                  background: "var(--bg-contrast)",
                  padding: "6px",
                }}
              >
                {filteredCatalog.map((item) => {
                  const isSelected = item.name === model;
                  const sizeLabel = item.source === "cloud" ? "" : formatSize(item.size);

                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => setModel(item.name)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid var(--border)",
                        background: isSelected ? "var(--bg-3)" : "var(--panel)",
                        color: "var(--ink)",
                        borderRadius: "8px",
                        padding: "8px",
                        marginBottom: "6px",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontSize: "12px", fontWeight: 600 }}>
                            {formatDisplayModelName(item.name, item.source)}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                            {item.source === "cloud" ? "Cloud" : "Local"}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              color:
                                item.source === "cloud"
                                  ? "var(--accent-2)"
                                  : item.installed
                                    ? "var(--success)"
                                    : "var(--warning)",
                            }}
                          >
                            {item.source === "cloud"
                              ? "Uso remoto"
                              : item.installed
                                ? "Baixado"
                                : "Precisa baixar"}
                          </span>
                          {item.running && (
                            <span style={{ fontSize: "11px", color: "var(--success)" }}>
                              Em execução
                            </span>
                          )}
                          {sizeLabel && (
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                              {sizeLabel}
                            </span>
                          )}
                        </div>
                        <AppButton
                          type="button"
                          variant="primary"
                          disabled={removingModelName === item.name}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRemoveModel(item.name);
                          }}
                          style={{ padding: "6px 10px", fontSize: "11px" }}
                        >
                          {removingModelName === item.name ? "Removendo..." : "Remover"}
                        </AppButton>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {showRegisterForm && (
              <div
                style={{
                  marginTop: "10px",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "12px",
                  background: "var(--panel)",
                }}
              >
                {registerStep === "form" && (
                  <>
                    <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--muted)" }}>
                      Informe o nome exato do modelo e selecione se é um modelo cloud ou local.
                    </p>
                    <div style={{ display: "grid", gap: "8px" }}>
                      <AppInput
                        value={registerName}
                        onChange={(event) => setRegisterName(event.target.value)}
                        placeholder="Ex: qwen3-coder"
                      />
                      <AppSelect
                        value={registerSource}
                        onChange={(event) =>
                          setRegisterSource(event.target.value as "" | "cloud" | "local")
                        }
                      >
                        <option value="">Selecione cloud ou local</option>
                        <option value="cloud">Cloud</option>
                        <option value="local">Local</option>
                      </AppSelect>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "10px",
                      }}
                    >
                      <AppButton
                        type="button"
                        variant="primary"
                        onClick={() => setShowRegisterForm(false)}
                      >
                        Cancelar
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="secondary"
                        disabled={!registerName.trim() || !registerSource}
                        onClick={() => void handleRegisterModel()}
                      >
                        {registerSource === "local" ? "Baixar modelo" : "Usar modelo"}
                      </AppButton>
                    </div>
                  </>
                )}

                {registerStep === "verifying" && (
                  <div className="loading-container" style={{ marginTop: 0 }}>
                    <div className="spinner" />
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      verificando se tudo está funcionando corretamente
                    </span>
                  </div>
                )}

                {registerStep === "success" && (
                  <div style={{ display: "grid", gap: "10px" }}>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--success)" }}>
                      {registerMessage || "Deu tudo certo."}
                    </p>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <AppButton
                        type="button"
                        variant="secondary"
                        onClick={() => setShowRegisterForm(false)}
                      >
                        Ok
                      </AppButton>
                    </div>
                  </div>
                )}

                {registerStep === "error" && (
                  <div style={{ display: "grid", gap: "10px" }}>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--danger)" }}>
                      {registerMessage || "Falha ao verificar o modelo."}
                    </p>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <AppButton
                        type="button"
                        variant="primary"
                        onClick={() => setRegisterStep("form")}
                      >
                        Voltar e editar
                      </AppButton>
                    </div>
                  </div>
                )}
              </div>
            )}
            {orderedCatalog.length > 0 && filteredCatalog.length === 0 && (
              <p style={{ marginTop: "10px", fontSize: "12px", color: "var(--muted)" }}>
                Nenhum modelo encontrado para esse filtro.
              </p>
            )}
          </div>

          <div style={{ marginBottom: "14px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                gap: "8px",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Modelo de Embedding
              </label>
              {!selectedEmbeddingDownloaded && (
                <span style={{ fontSize: "12px", color: "var(--warning)", fontWeight: 600 }}>
                  Modelo não baixado
                </span>
              )}
            </div>

            <AppSelect
              value={selectedEmbeddingModel}
              onChange={(event) => setSelectedEmbeddingModel(event.target.value)}
              fullWidth
              style={{
                padding: "10px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                backgroundColor: "var(--bg-contrast)",
                color: "var(--ink)",
              }}
            >
              {embeddingModelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </AppSelect>

            <div
              style={{
                marginTop: "8px",
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              {!selectedEmbeddingDownloaded && (
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => void handleDownloadEmbeddingModel()}
                  disabled={isDownloadingEmbedding || !selectedEmbeddingModel.trim()}
                  style={{ padding: "8px 12px", fontSize: "12px" }}
                >
                  {isDownloadingEmbedding ? "Baixando..." : "Baixar modelo"}
                </AppButton>
              )}
              <AppButton
                type="button"
                variant="primary"
                onClick={openEmbeddingRegisterForm}
                style={{ padding: "8px 12px", fontSize: "12px" }}
              >
                Adicionar modelo
              </AppButton>
            </div>

            {showEmbeddingRegisterForm && (
              <div
                style={{
                  marginTop: "10px",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "12px",
                  background: "var(--panel)",
                }}
              >
                <p style={{ margin: "0 0 10px", fontSize: "12px", color: "var(--muted)" }}>
                  Informe o nome exato do modelo de embedding para adicionar na lista.
                </p>
                <AppInput
                  value={embeddingRegisterName}
                  onChange={(event) => setEmbeddingRegisterName(event.target.value)}
                  placeholder="Ex: nomic-embed-text"
                  fullWidth
                />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    marginTop: "10px",
                  }}
                >
                  <AppButton
                    type="button"
                    variant="primary"
                    onClick={() => setShowEmbeddingRegisterForm(false)}
                  >
                    Cancelar
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={!embeddingRegisterName.trim()}
                    onClick={handleAddEmbeddingModel}
                  >
                    Adicionar modelo
                  </AppButton>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                gap: "8px",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                System Prompt
              </label>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                {savedPrompts.length > 0 && (
                  <AppButton
                    type="button"
                    variant="primary"
                    onClick={() => void handleOpenSavedPromptsDialog()}
                    style={{ padding: "8px 12px", fontSize: "12px" }}
                  >
                    Prompts salvos
                  </AppButton>
                )}
                <AppButton
                  type="button"
                  variant="primary"
                  onClick={() => {
                    setSavedPromptFeedback(null);
                    setNewPromptName("");
                    setShowSavePromptDialog(true);
                  }}
                  style={{ padding: "8px 12px", fontSize: "12px" }}
                >
                  Salvar prompt
                </AppButton>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: "100%",
                minHeight: "400px",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontFamily: "monospace",
                fontSize: "12px",
                resize: "vertical",
                boxSizing: "border-box",
              }}
              placeholder="Cole o system prompt aqui..."
            />
          </div>
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <AppButton
              onClick={onCancel}
              variant="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Cancelar
            </AppButton>
            <AppButton
              onClick={() => {
                setResetPromptError(null);
                setShowResetPromptDialog(true);
              }}
              disabled={action.busy}
              variant="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Resetar prompt
            </AppButton>
            <AppButton
              onClick={() => onSave(model, prompt, selectedEmbeddingModel, customEmbeddingModels)}
              disabled={action.busy || !model || !selectedEmbeddingModel.trim()}
              variant="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Salvar
            </AppButton>
          </div>

          {showResetPromptDialog && (
            <div className="dialog-overlay" onClick={() => setShowResetPromptDialog(false)}>
              <div
                className="dialog"
                onClick={(event) => event.stopPropagation()}
                style={{ maxWidth: "520px" }}
              >
                <div className="dialog-header">
                  <h3>Resetar prompt</h3>
                </div>
                <div className="dialog-content" style={{ padding: "20px" }}>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>
                    Isso vai substituir o prompt atual pela versão padrão recomendada do sistema.
                    Deseja continuar?
                  </p>
                  {resetPromptError && (
                    <p
                      style={{
                        margin: "12px 0 0 0",
                        color: "var(--danger)",
                        fontSize: "13px",
                      }}
                    >
                      {resetPromptError}
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "16px",
                    }}
                  >
                    <AppButton
                      onClick={() => setShowResetPromptDialog(false)}
                      disabled={isResettingPrompt}
                      variant="primary"
                      style={{
                        padding: "10px 20px",
                        borderRadius: "8px",
                      }}
                    >
                      Cancelar
                    </AppButton>
                    <AppButton
                      onClick={() => void handleResetPrompt()}
                      disabled={isResettingPrompt}
                      variant="secondary"
                      style={{
                        padding: "10px 20px",
                        borderRadius: "8px",
                      }}
                    >
                      {isResettingPrompt ? "Resetando..." : "Continuar"}
                    </AppButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showSavePromptDialog && (
            <div className="dialog-overlay" onClick={() => setShowSavePromptDialog(false)}>
              <div
                className="dialog"
                onClick={(event) => event.stopPropagation()}
                style={{ maxWidth: "700px", width: "90vw" }}
              >
                <div className="dialog-header">
                  <h3>Salvar prompt atual</h3>
                </div>
                <div className="dialog-content" style={{ padding: "20px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    Nome do prompt
                  </label>
                  <AppInput
                    value={newPromptName}
                    onChange={(event) => setNewPromptName(event.target.value)}
                    placeholder="Ex: Entrevista longa com foco em storytelling"
                    fullWidth
                  />

                  <label
                    style={{
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      marginTop: "14px",
                      marginBottom: "8px",
                    }}
                  >
                    Prompt que será salvo
                  </label>
                  <textarea
                    value={prompt}
                    readOnly
                    style={{
                      width: "100%",
                      minHeight: "260px",
                      padding: "12px",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      resize: "vertical",
                      boxSizing: "border-box",
                      backgroundColor: "var(--bg-contrast)",
                    }}
                  />

                  {savedPromptFeedback && (
                    <p style={{ margin: "10px 0 0", color: "var(--danger)", fontSize: "13px" }}>
                      {savedPromptFeedback}
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "14px",
                    }}
                  >
                    <AppButton
                      type="button"
                      variant="primary"
                      onClick={() => setShowSavePromptDialog(false)}
                      disabled={isSavingPrompt}
                    >
                      Cancelar
                    </AppButton>
                    <AppButton
                      type="button"
                      variant="secondary"
                      onClick={() => void handleSaveCurrentPrompt()}
                      disabled={isSavingPrompt}
                    >
                      {isSavingPrompt ? "Salvando..." : "Salvar"}
                    </AppButton>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showSavedPromptsDialog && (
            <div className="dialog-overlay" onClick={() => setShowSavedPromptsDialog(false)}>
              <div
                className="dialog"
                onClick={(event) => event.stopPropagation()}
                style={{ maxWidth: "760px", width: "92vw" }}
              >
                <div className="dialog-header">
                  <h3>Prompts salvos</h3>
                </div>
                <div className="dialog-content" style={{ padding: "20px" }}>
                  {isLoadingSavedPrompts ? (
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
                      Carregando prompts salvos...
                    </p>
                  ) : savedPrompts.length === 0 ? (
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
                      Ainda não existem prompts salvos.
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gap: "10px",
                        maxHeight: "420px",
                        overflowY: "auto",
                        paddingRight: "4px",
                      }}
                    >
                      {savedPrompts.map((savedPrompt) => {
                        const isExpanded = expandedSavedPromptId === savedPrompt.id;
                        const isChecked = selectedSavedPromptId === savedPrompt.id;
                        return (
                          <div
                            key={savedPrompt.id}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: "8px",
                              padding: "10px",
                              backgroundColor: "var(--panel)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "10px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <AppButton
                                  type="button"
                                  variant="primary"
                                  style={{ padding: "6px 10px", fontSize: "12px" }}
                                  onClick={() =>
                                    setExpandedSavedPromptId((current) =>
                                      current === savedPrompt.id ? null : savedPrompt.id,
                                    )
                                  }
                                >
                                  {isExpanded ? "Ocultar" : "Mostrar mais"}
                                </AppButton>
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    cursor: "pointer",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(event) => {
                                      if (event.target.checked) {
                                        setSelectedSavedPromptId(savedPrompt.id);
                                      } else {
                                        setSelectedSavedPromptId(null);
                                      }
                                    }}
                                  />
                                  <span style={{ fontSize: "13px", fontWeight: 600 }}>
                                    {savedPrompt.name}
                                  </span>
                                </label>
                              </div>
                            </div>
                            {isExpanded && (
                              <textarea
                                readOnly
                                value={savedPrompt.prompt}
                                style={{
                                  width: "100%",
                                  minHeight: "180px",
                                  marginTop: "10px",
                                  padding: "10px",
                                  borderRadius: "8px",
                                  border: "1px solid var(--border)",
                                  fontFamily: "monospace",
                                  fontSize: "12px",
                                  resize: "vertical",
                                  boxSizing: "border-box",
                                  backgroundColor: "var(--bg-contrast)",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {savedPromptFeedback && (
                    <p style={{ margin: "10px 0 0", color: "var(--danger)", fontSize: "13px" }}>
                      {savedPromptFeedback}
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: "8px",
                      marginTop: "14px",
                    }}
                  >
                    <AppButton
                      type="button"
                      variant="primary"
                      onClick={() => setShowSavedPromptsDialog(false)}
                    >
                      Cancelar
                    </AppButton>
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={savedPrompts.length === 0}
                      onClick={handleApplySavedPrompt}
                    >
                      Salvar
                    </AppButton>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
