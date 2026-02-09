interface ConfigurationPanelProps {
  onShowConfigureAppDialog: () => void;
  onShowDependenciesDialog: () => void;
  onShowLLMConfigDialog: () => void;
  onShowWhisperConfigDialog: () => void;
}

export function ConfigurationPanel({
  onShowConfigureAppDialog,
  onShowDependenciesDialog,
  onShowLLMConfigDialog,
  onShowWhisperConfigDialog,
}: ConfigurationPanelProps) {
  return (
    <section className="panel">
      <h2>Configurações</h2>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        {/* Card Configurar Aplicação */}
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: "10px",
            padding: "12px",
            background: "#fff",
          }}
        >
          <button
            onClick={onShowConfigureAppDialog}
            style={{
              width: "100%",
              borderRadius: "8px",
              background: "#8b5cf6",
              color: "white",
              border: "none",
              padding: "10px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            ⚙️ Configurar aplicação
          </button>
          <p
            className="muted"
            style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
          >
            Define onde os vídeos, shorts e transcrições serão armazenados.
          </p>
        </div>

        {/* Card Dependências */}
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: "10px",
            padding: "12px",
            background: "#fff",
          }}
        >
          <button
            onClick={onShowDependenciesDialog}
            style={{
              width: "100%",
              borderRadius: "8px",
              background: "#06b6d4",
              color: "white",
              border: "none",
              padding: "10px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            📦 Gerenciar dependências
          </button>
          <p
            className="muted"
            style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
          >
            Verifica se as ferramentas necessárias estão instaladas.
          </p>
        </div>

        {/* Card LLM */}
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: "10px",
            padding: "12px",
            background: "#fff",
          }}
        >
          <button
            onClick={onShowLLMConfigDialog}
            style={{
              width: "100%",
              borderRadius: "8px",
              background: "#f59e0b",
              color: "white",
              border: "none",
              padding: "10px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            🤖 Configurar LLM
          </button>
          <p
            className="muted"
            style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
          >
            Edita o prompt do sistema para análise com IA.
          </p>
        </div>

        {/* Card Whisper */}
        <div
          style={{
            border: "1px solid #e5e5e5",
            borderRadius: "10px",
            padding: "12px",
            background: "#fff",
          }}
        >
          <button
            onClick={onShowWhisperConfigDialog}
            style={{
              width: "100%",
              borderRadius: "8px",
              background: "#8b5cf6",
              color: "white",
              border: "none",
              padding: "10px",
              cursor: "pointer",
              fontWeight: "600",
            }}
          >
            🎙️ Configurar Whisper
          </button>
          <p
            className="muted"
            style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
          >
            Personaliza o dispositivo e formatos de transcrição.
          </p>
        </div>
      </div>
    </section>
  );
}
