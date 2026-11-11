import { GlassCard, GlassButton, GlassBadge } from "./ui/glass";

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
}: RenderingSectionProps) {
  return (
    <div className="space-y-6">
      {/* Cabecalho da Secao */}
      <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-white tracking-tight">
            Shorts Concluídos
          </h2>
          <p className="text-xs text-text-3">
            Vídeos renderizados em formato vertical (1080x1920) prontos para publicação
          </p>
        </div>
        <GlassBadge variant="score" size="sm">
          {renderOutputs.length} {renderOutputs.length === 1 ? "vídeo pronto" : "vídeos prontos"}
        </GlassBadge>
      </div>

      {isLoadingRenderOutputs ? (
        <div className="flex items-center justify-center p-12 text-xs text-text-3 gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <span>Carregando arquivos renderizados...</span>
        </div>
      ) : renderOutputs.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-white/[0.05] border border-white/10 flex items-center justify-center text-text-3">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="2" width="20" height="20" rx="4" />
              <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text-2">
              {isRendering ? "Renderizando Shorts em segundo plano..." : "Nenhum Short finalizado ainda"}
            </p>
            <p className="text-xs text-text-3 mt-1">
              {isRendering
                ? "Os arquivos aparecerão aqui assim que o FFmpeg concluir o processamento."
                : "Vá para a aba Workspace, selecione um corte e clique em 'Renderizar Short'."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {renderOutputs.map((path) => {
            const url = buildRenderUrl(path);
            const fileName = path.split("/").pop() || "render.mp4";
            const suggestedTitle = renderTitlesByFileName[fileName] || "Corte em destaque";

            return (
              <GlassCard
                key={path}
                className="flex flex-col justify-between overflow-hidden p-3.5 space-y-3 border-white/[0.1] bg-[#0e0e12]/80 hover:border-white/20 transition-all duration-200"
              >
                {/* Video Player 9:16 Preview */}
                <div className="w-full aspect-[9/14] bg-black/80 rounded-xl border border-white/10 overflow-hidden relative group">
                  <video
                    controls
                    preload="metadata"
                    src={url}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      console.error(`[UI] Error loading video: ${url}`, e);
                    }}
                  />
                  <div className="absolute top-2 right-2 pointer-events-none">
                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-white border border-white/10">
                      1080x1920
                    </span>
                  </div>
                </div>

                {/* Metadados e Titulo */}
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-white leading-snug line-clamp-2">
                    {suggestedTitle}
                  </p>
                  <p className="text-[11px] font-mono text-text-3 truncate">
                    {fileName}
                  </p>
                </div>

                {/* Botoes de Acao */}
                <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
                  <GlassButton
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = url;
                      a.target = "_blank";
                      a.rel = "noreferrer";
                      a.download = fileName;
                      a.click();
                    }}
                    leadingIcon={
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    }
                  >
                    Baixar
                  </GlassButton>

                  <GlassButton
                    variant="glass"
                    size="sm"
                    onClick={async () => {
                      try {
                        await onOpenRenderFolder(fileName);
                      } catch (error) {
                        console.error("Failed to open folder:", error);
                      }
                    }}
                    title="Abrir pasta no computador"
                    leadingIcon={
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    }
                  >
                    Pasta
                  </GlassButton>

                  <GlassButton
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      try {
                        await onDeleteRender(fileName);
                      } catch (error) {
                        console.error("Failed to delete render:", error);
                      }
                    }}
                    title="Excluir arquivo de render"
                    leadingIcon={
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    }
                  />
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
