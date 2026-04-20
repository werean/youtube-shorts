import { AppButton } from "./shared";

interface ConfigurationSectionProps {
  onConfigureApp: () => void;
  onManageDependencies: () => void;
  onConfigureLLM: () => void;
  onConfigureWhisper: () => void;
  onConfigureFFmpeg: () => void;
  onShowHowToUse?: () => void;
}

export function ConfigurationSection({
  onConfigureApp,
  onManageDependencies,
  onConfigureLLM,
  onConfigureWhisper,
  onConfigureFFmpeg,
  onShowHowToUse,
}: ConfigurationSectionProps) {
  const cards = [
    {
      title: "Configurar aplicação",
      description: "Define onde os vídeos, shorts e transcrições serão armazenados.",
      className: "purple",
      onClick: onConfigureApp,
    },
    {
      title: "Gerenciar dependências",
      description: "Verifica se as ferramentas necessárias estão instaladas.",
      className: "cyan",
      onClick: onManageDependencies,
    },
    {
      title: "Configurar LLM",
      description: "Configura o modelo de IA para análise de vídeos.",
      className: "orange",
      onClick: onConfigureLLM,
    },
    {
      title: "Configurar Whisper",
      description: "Define o modelo Whisper e parâmetros de transcrição.",
      className: "green",
      onClick: onConfigureWhisper,
    },
    {
      title: "Configurar FFmpeg",
      description: "Define parâmetros de renderização de vídeo.",
      className: "pink",
      onClick: onConfigureFFmpeg,
    },
    {
      title: "Como utilizar",
      description: "Veja um guia rápido para usar o fluxo completo da aplicação.",
      className: "cyan",
      onClick: onShowHowToUse || (() => {}),
    },
  ];

  return (
    <section className="panel">
      <h2 style={{ marginBottom: "12px" }}>Configurações</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        {cards.map((card) => (
          <div key={card.title} className="config-card">
            <AppButton onClick={card.onClick} className={`config-card-button ${card.className}`}>
              {card.title}
            </AppButton>
            <p className="config-card-description">{card.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
