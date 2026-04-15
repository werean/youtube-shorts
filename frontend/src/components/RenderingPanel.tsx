import { apiBaseUrl } from "../api";

interface RenderingPanelProps {
  renderOutputs: string[];
  isRendering: boolean;
}

function buildRenderUrl(renderPath: string): string {
  if (!renderPath) return "";
  if (renderPath.startsWith("http://") || renderPath.startsWith("https://")) {
    return renderPath;
  }
  const normalized = renderPath.startsWith("/") ? renderPath : `/${renderPath}`;
  return `${apiBaseUrl}${normalized}`;
}

export function RenderingPanel({ renderOutputs, isRendering }: RenderingPanelProps) {
  return (
    <section className="panel">
      <h2>6. Saída final</h2>
      {renderOutputs.length === 0 ? (
        <p className="muted">{isRendering ? "Gerando cortes..." : "Nenhum render finalizado."}</p>
      ) : (
        <ul className="render-list">
          {renderOutputs.map((path) => {
            const url = buildRenderUrl(path);
            const fileName = path.split("/").pop() || "render.mp4";
            return (
              <li key={path}>
                <video controls src={url} style={{ width: "100%", maxWidth: "360px" }} />
                <div className="muted" style={{ marginTop: "6px" }}>
                  {fileName}
                </div>
                <a href={url} target="_blank" rel="noreferrer">
                  Abrir video
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


