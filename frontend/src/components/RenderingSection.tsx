import { AppButton } from "./shared";

interface RenderingSectionProps {
  isLoadingRenderOutputs: boolean;
  isRendering: boolean;
  renderOutputs: string[];
  renderTitlesByFileName: Record<string, string>;
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
  renderTitlesByFileName,
  buildRenderUrl,
  onDeleteRender,
  onOpenRenderFolder,
  isExpanded,
  onToggle,
}: RenderingSectionProps) {
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
              const suggestedTitle = renderTitlesByFileName[fileName] || "Corte em destaque";
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

                    <AppButton
                      className="menu-button"
                      onClick={async () => {
                        try {
                          await onOpenRenderFolder(fileName);
                        } catch (error) {
                          console.error("Failed to open folder:", error);
                        }
                      }}
                    >
                      Abrir pasta
                    </AppButton>
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
                  <p style={{ margin: "0 0 12px", fontSize: "0.93rem", fontWeight: 600 }}>
                    {suggestedTitle}
                  </p>
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
