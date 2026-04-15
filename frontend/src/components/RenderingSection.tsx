import { useState } from "react";
import { AppButton } from "./shared";

interface RenderingSectionProps {
  isLoadingRenderOutputs: boolean;
  isRendering: boolean;
  renderOutputs: string[];
  buildRenderUrl: (path: string) => string;
  onDeleteRender: (fileName: string) => Promise<void>;
  onOpenRenderFolder: (fileName: string) => Promise<void>;
  isExpanded: boolean;
  onToggle: () => void;
}

export function RenderingSection({
  isLoadingRenderOutputs,
  isRendering,
  renderOutputs,
  buildRenderUrl,
  onDeleteRender,
  onOpenRenderFolder,
  isExpanded,
  onToggle,
}: RenderingSectionProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  return (
    <section className="panel" style={{ marginBottom: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0, flex: 1 }}>5. Renderização</h2>
        <AppButton
          variant="ghost"
          onClick={onToggle}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
          }}
          title={isExpanded ? "Recolher" : "Expandir"}
        >
          <i
            className="material-icons"
            style={{
              transform: isExpanded ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.3s ease",
            }}
          >
            keyboard_arrow_down
          </i>
        </AppButton>
      </div>
      {isExpanded &&
        (isLoadingRenderOutputs ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                border: "3px solid var(--border)",
                borderTop: "3px solid var(--muted)",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span>Carregando renderizações...</span>
          </div>
        ) : renderOutputs.length === 0 ? (
          <p className="muted">{isRendering ? "Gerando cortes..." : "Nenhum render finalizado."}</p>
        ) : (
          <div className="shorts-grid">
            {renderOutputs.map((path) => {
              const url = buildRenderUrl(path);
              const fileName = path.split("/").pop() || "render.mp4";
              console.log(`[UI] Render output path: ${path}, URL: ${url}`);
              return (
                <article key={path} className="short-card">
                  <header
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <h3 style={{ margin: 0, paddingRight: "8px" }}>{fileName}</h3>

                    <div style={{ position: "relative" }}>
                      <AppButton
                        className="menu-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId((current) => (current === path ? null : path));
                        }}
                      >
                        ...
                      </AppButton>

                      {menuOpenId === path && (
                        <div className="menu-popover">
                          <AppButton
                            onClick={async () => {
                              try {
                                await onOpenRenderFolder(fileName);
                              } catch (error) {
                                console.error("Failed to open folder:", error);
                              } finally {
                                setMenuOpenId(null);
                              }
                            }}
                          >
                            Open Folder
                          </AppButton>
                        </div>
                      )}
                    </div>
                  </header>
                  <div style={{ overflow: "hidden", borderRadius: "12px", marginBottom: "12px" }}>
                    <video
                      controls
                      preload="metadata"
                      src={url}
                      style={{
                        width: "100%",
                        height: "280px",
                        objectFit: "cover",
                        display: "block",
                      }}
                      onError={(e) => {
                        console.error(`[UI] Error loading video: ${url}`, e);
                      }}
                      onLoadedMetadata={() => {
                        console.log(`[UI] Video metadata loaded: ${url}`);
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <AppButton
                      variant="secondary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = url;
                        a.target = "_blank";
                        a.rel = "noreferrer";
                        a.click();
                      }}
                    >
                      Abrir vídeo
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await onDeleteRender(fileName);
                        } catch (error) {
                          console.error("Failed to delete render:", error);
                        }
                      }}
                    >
                      Deletar
                    </AppButton>
                  </div>
                </article>
              );
            })}
          </div>
        ))}
    </section>
  );
}

