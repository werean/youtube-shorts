import { useEffect, useState } from "react";
import { getInstallationGuide, type InstallationGuide } from "../../api";
import { AppDialog } from "../shared";
import { GlassButton, GlassCard } from "../ui/glass";

interface InstallationInstructionsDialogProps {
  dependencyName: string;
  onClose: () => void;
}

export function InstallationInstructionsDialog({
  dependencyName,
  onClose,
}: InstallationInstructionsDialogProps) {
  const [guide, setGuide] = useState<InstallationGuide | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getInstallationGuide(dependencyName);
        setGuide(data);
      } catch (error) {
        console.error("Failed to load installation guide:", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [dependencyName]);

  const title = guide?.manual?.title || `Instruções de Instalação: ${dependencyName}`;

  return (
    <AppDialog
      title={title}
      description={guide?.manual?.description}
      onClose={onClose}
      wide
      scrollable
    >
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-12 text-zinc-400 gap-3">
          <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-xs">Carregando instruções oficiais...</p>
        </div>
      ) : !guide ? (
        <div className="p-8 text-center text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-xs font-medium">Não foi possível carregar as instruções para esta dependência.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Passos de Instalação */}
          <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-3">
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              Passo a Passo
            </h4>
            <ol className="space-y-2.5 pt-1">
              {guide.manual.steps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 p-2.5 rounded-lg bg-black/30 border border-white/[0.06] text-xs text-zinc-200"
                >
                  <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.08] text-white font-mono text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed flex-1 font-mono">{step}</span>
                </li>
              ))}
            </ol>
          </GlassCard>

          {/* Links Úteis */}
          {guide.manual.links && guide.manual.links.length > 0 && (
            <GlassCard className="p-4 border-white/10 bg-white/[0.02] space-y-2.5">
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Documentação e Downloads
              </h4>
              <ul className="space-y-1.5 pt-1">
                {guide.manual.links.map((link, idx) => (
                  <li key={idx}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors p-1"
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <span>{link.title || link.url}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>
      )}
    </AppDialog>
  );
}
