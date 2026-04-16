import { useEffect, useMemo, useState } from "react";
import type { ActionState } from "../hooks/useAppAction";
import { AppButton, AppInput, AppSelect } from "./shared";

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
  availableModels: string[];
  modelCatalog?: OllamaModelCatalogItem[];
  localAvailable?: boolean;
  remoteAvailable?: boolean;
  llmSystemPrompt: string;
  llmAverageCutMinutes: number;
  llmMaxExtraMinutes: number;
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
    averageCutMinutes: number,
    maxExtraMinutes: number,
  ) => void;
  onCancel: () => void;
}

type ModelFilter = "all" | "cloud" | "local";
type RegisterStep = "form" | "verifying" | "success" | "error";

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
  availableModels,
  modelCatalog = [],
  llmSystemPrompt: initialPrompt,
  llmAverageCutMinutes: initialAverageCutMinutes,
  llmMaxExtraMinutes: initialMaxExtraMinutes,
  action,
  onRegisterModel,
  onRemoveModel,
  onRefreshModels,
  onSave,
  onCancel,
}: LLMConfigDialogProps) {
  const [model, setModel] = useState(initialModel);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [averageCutMinutes, setAverageCutMinutes] = useState(
    Number.isFinite(initialAverageCutMinutes) ? initialAverageCutMinutes : 1,
  );
  const [maxExtraMinutes, setMaxExtraMinutes] = useState(
    Number.isFinite(initialMaxExtraMinutes) ? initialMaxExtraMinutes : 0,
  );
  const [modelFilter, setModelFilter] = useState<ModelFilter>("all");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerSource, setRegisterSource] = useState<"" | "cloud" | "local">("");
  const [registerStep, setRegisterStep] = useState<RegisterStep>("form");
  const [registerMessage, setRegisterMessage] = useState("");
  const [removingModelName, setRemovingModelName] = useState<string | null>(null);

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

  function formatMinutesAndSeconds(minutes: number): string {
    const totalSeconds = Math.round(Math.max(0, minutes) * 60);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (secs === 0) {
      return `${mins} min`;
    }
    return `${mins} min ${secs}s`;
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

  useEffect(() => {
    if (!model && modelOptions.length > 0) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions]);

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

            <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
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

            <div style={{ marginTop: "10px", display: "flex", justifyContent: "flex-end" }}>
              <AppButton
                type="button"
                variant="primary"
                onClick={openRegisterModelForm}
                style={{ padding: "8px 12px", fontSize: "12px" }}
              >
                Adicionar modelo
              </AppButton>
            </div>

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
                      Informe o nome exato do modelo e selecione cloud ou local.
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

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              Duração média por corte (minutos)
            </label>
            <AppInput
              type="number"
              min={0.25}
              max={60}
              step={0.25}
              value={averageCutMinutes}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isFinite(parsed)) {
                  setAverageCutMinutes(1);
                  return;
                }
                setAverageCutMinutes(Math.max(0.25, parsed));
              }}
            />
            <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--muted)" }}>
              O tempo é em média. O corte pode acabar antes se o contexto finalizar antes.
            </p>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              Tolerância para estender contexto: {formatMinutesAndSeconds(maxExtraMinutes)}
            </label>
            <input
              type="range"
              min={0}
              max={10}
              step={0.25}
              value={maxExtraMinutes}
              onChange={(e) => setMaxExtraMinutes(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--muted)" }}>
              0 a 10 minutos extras (em passos de 15 segundos) somente quando necessário para
              concluir o assunto.
            </p>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: "500",
                marginBottom: "8px",
              }}
            >
              System Prompt
            </label>
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
              onClick={() => onSave(model, prompt, averageCutMinutes, maxExtraMinutes)}
              disabled={action.busy || !model || averageCutMinutes <= 0}
              variant="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Salvar
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  );
}
