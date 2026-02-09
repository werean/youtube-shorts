import type React from "react";

interface Dependency {
  installed: boolean;
  version: string | null;
}

interface DependenciesDialogProps {
  dependencies: Record<string, Dependency> | null;
  loadingDependencies: Set<string>;
  installingDependency: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onShowInstallInstructions: (name: string) => void;
  onInstallDependency: (name: string) => Promise<void>;
}

export function DependenciesDialog({
  dependencies,
  loadingDependencies,
  installingDependency,
  onClose,
  onRefresh,
  onShowInstallInstructions,
  onInstallDependency,
}: DependenciesDialogProps) {
  const deps = dependencies || {
    python: { installed: false, version: null },
    whisper: { installed: false, version: null },
    ffmpeg: { installed: false, version: null },
    cuda: { installed: false, version: null },
    pytorch: { installed: false, version: null },
    ollama: { installed: false, version: null },
  };

  const isLoadingInitial = !dependencies;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "500px" }}
      >
        <div className="dialog-header">
          <h3>📦 Gerenciar dependências</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {Object.entries(deps).map(([name, status]) => {
              const isLoading = loadingDependencies.has(name);
              const displayName =
                name === "pytorch" ? "PyTorch" : name.charAt(0).toUpperCase() + name.slice(1);

              return (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    padding: "14px 16px",
                    borderRadius: "8px",
                    border: "1px solid #e5e5e5",
                    background:
                      isLoading || isLoadingInitial
                        ? "#f3f4f6"
                        : status.installed
                          ? "#f0fdf4"
                          : "#fef2f2",
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
                        <span style={{ fontWeight: "600", fontSize: "14px", color: "#9ca3af" }}>
                          {displayName}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontWeight: "600", fontSize: "14px", textAlign: "center" }}>
                        {displayName}
                        {!isLoading && status.version && (
                          <span style={{ fontWeight: "normal", color: "#666", marginLeft: "6px" }}>
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
                            width: "24px",
                            height: "24px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "14px",
                            fontWeight: "bold",
                            background: status.installed ? "#10b981" : "#ef4444",
                            color: "white",
                          }}
                        >
                          {status.installed ? "✓" : "✗"}
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
                    <button
                      onClick={() => onShowInstallInstructions(name)}
                      disabled={isLoading || isLoadingInitial}
                      className="secondary"
                      style={{
                        padding: "4px 8px",
                        fontSize: "12px",
                        opacity: isLoading || isLoadingInitial ? 0.6 : 1,
                      }}
                    >
                      📋 Manual
                    </button>
                    {name !== "ollama" && (
                      <button
                        disabled={installingDependency === name || isLoading || isLoadingInitial}
                        onClick={() => onInstallDependency(name)}
                        className="secondary"
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          color:
                            installingDependency === name || isLoading || isLoadingInitial
                              ? "#9ca3af"
                              : "#10b981",
                          opacity:
                            installingDependency === name || isLoading || isLoadingInitial
                              ? 0.6
                              : 1,
                        }}
                      >
                        {installingDependency === name ? "⏳ Instalando..." : "⚡ Automático"}
                      </button>
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
              background: "#f9fafb",
              borderRadius: "8px",
            }}
          >
            <p style={{ fontSize: "12px", color: "#666", margin: 0, lineHeight: "1.5" }}>
              <strong>Nota:</strong> Dependências marcadas com ✗ precisam ser instaladas
              manualmente. Consulte a documentação do projeto para instruções de instalação.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              justifyContent: "flex-end",
              marginTop: "16px",
            }}
          >
            <button onClick={onRefresh} className="secondary" style={{ padding: "10px 20px" }}>
              🔄 Atualizar
            </button>
            <button onClick={onClose} className="primary" style={{ padding: "10px 20px" }}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
