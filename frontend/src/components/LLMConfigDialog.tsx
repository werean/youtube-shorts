import { useEffect, useMemo, useState } from "react";
import type { ActionState } from "../hooks/useAppAction";
import { AppButton, AppSelect } from "./shared";

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
  action: ActionState;
  onSave: (model: string, prompt: string) => void;
  onCancel: () => void;
}

export function LLMConfigDialog({
  llmModel: initialModel,
  availableModels,
  modelCatalog = [],
  localAvailable,
  remoteAvailable,
  llmSystemPrompt: initialPrompt,
  action,
  onSave,
  onCancel,
}: LLMConfigDialogProps) {
  const [model, setModel] = useState(initialModel);
  const [prompt, setPrompt] = useState(initialPrompt);

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
      next.set(name, item);
    }
    return next;
  }, [modelCatalog]);

  const orderedCatalog = useMemo(() => {
    const fromCatalog = Array.from(catalogByName.values());
    const known = new Set(fromCatalog.map((item) => item.name));

    for (const name of modelOptions) {
      if (!known.has(name)) {
        fromCatalog.push({
          name,
          source: "local",
          installed: true,
          running: false,
          needsDownload: false,
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

  const selectedModelMeta = model ? catalogByName.get(model) : undefined;

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
      return option;
    }

    if (item.running) {
      return `${option} • local (em execução)`;
    }

    if (item.installed) {
      return `${option} • local (baixado)`;
    }

    return `${option} • cloud (baixar)`;
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
          <div className="dialog-actions">
            <AppButton variant="secondary" onClick={onCancel} style={{ padding: "8px 12px" }}>
              Fechar
            </AppButton>
          </div>
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
              <span
                style={{
                  fontSize: "11px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  padding: "2px 8px",
                  color: localAvailable ? "var(--success)" : "var(--muted)",
                  background: "var(--bg-contrast)",
                }}
              >
                Local {localAvailable ? "online" : "offline"}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  borderRadius: "999px",
                  border: "1px solid var(--border)",
                  padding: "2px 8px",
                  color: remoteAvailable ? "var(--accent-2)" : "var(--muted)",
                  background: "var(--bg-contrast)",
                }}
              >
                Catálogo cloud {remoteAvailable ? "online" : "offline"}
              </span>
              {selectedModelMeta && (
                <span
                  style={{
                    fontSize: "11px",
                    borderRadius: "999px",
                    border: "1px solid var(--border)",
                    padding: "2px 8px",
                    color: selectedModelMeta.running
                      ? "var(--success)"
                      : selectedModelMeta.installed
                        ? "var(--accent-2)"
                        : "var(--warning)",
                    background: "var(--bg-contrast)",
                  }}
                >
                  {selectedModelMeta.running
                    ? "Em execução"
                    : selectedModelMeta.installed
                      ? "Baixado local"
                      : "Precisa baixar"}
                </span>
              )}
            </div>

            {orderedCatalog.length > 0 && (
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
                {orderedCatalog.map((item) => {
                  const isSelected = item.name === model;
                  const sizeLabel = formatSize(item.size);

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
                        }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{item.name}</span>
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                          {item.source === "cloud" ? "☁️ Cloud" : "💻 Local"}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            color: item.installed ? "var(--success)" : "var(--warning)",
                          }}
                        >
                          {item.installed ? "Baixado" : "Precisa baixar"}
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
                    </button>
                  );
                })}
              </div>
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
              variant="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Cancelar
            </AppButton>
            <AppButton
              onClick={() => onSave(model, prompt)}
              disabled={action.busy || !model}
              variant="primary"
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
