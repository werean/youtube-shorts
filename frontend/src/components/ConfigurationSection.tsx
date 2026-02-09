interface ConfigurationSectionProps {
  onConfigureApp: () => void;
  onManageDependencies: () => void;
  onConfigureLLM: () => void;
  onConfigureWhisper: () => void;
  onConfigureFFmpeg: () => void;
  onBatchPipeline: () => void;
}

export function ConfigurationSection({
  onConfigureApp,
  onManageDependencies,
  onConfigureLLM,
  onConfigureWhisper,
  onConfigureFFmpeg,
  onBatchPipeline,
}: ConfigurationSectionProps) {
  return (
    <section className="panel">
      <h2>Configurações</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        {/* Card Configurar Aplicação */}
        <div className="config-card">
          <button onClick={onConfigureApp} className="config-card-button purple">
            ⚙️ Configurar aplicação
          </button>
          <p className="config-card-description">
            Define onde os vídeos, shorts e transcrições serão armazenados.
          </p>
        </div>

        {/* Card Dependências */}
        <div className="config-card">
          <button onClick={onManageDependencies} className="config-card-button cyan">
            📦 Gerenciar dependências
          </button>
          <p className="config-card-description">
            Verifica se as ferramentas necessárias estão instaladas.
          </p>
        </div>

        {/* Card LLM */}
        <div className="config-card">
          <button onClick={onConfigureLLM} className="config-card-button orange">
            🤖 Configurar LLM
          </button>
          <p className="config-card-description">
            Configura o modelo de IA para análise de vídeos.
          </p>
        </div>

        {/* Card Whisper */}
        <div className="config-card">
          <button onClick={onConfigureWhisper} className="config-card-button green">
            🎤 Configurar Whisper
          </button>
          <p className="config-card-description">
            Define o modelo Whisper e parâmetros de transcrição.
          </p>
        </div>

        {/* Card FFmpeg */}
        <div className="config-card">
          <button onClick={onConfigureFFmpeg} className="config-card-button pink">
            🎬 Configurar FFmpeg
          </button>
          <p className="config-card-description">Define parâmetros de renderização de vídeo.</p>
        </div>

        {/* Card Batch Pipeline */}
        <div className="config-card">
          <button onClick={onBatchPipeline} className="config-card-button indigo">
            ⚡ Pipeline em lote
          </button>
          <p className="config-card-description">Processa vários vídeos automaticamente.</p>
        </div>
      </div>
    </section>
  );
}
