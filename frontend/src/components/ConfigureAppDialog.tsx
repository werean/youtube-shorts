import { useState } from "react";
import { selectFolder } from "../api";
import type { ActionState } from "../hooks/useAppAction";

interface ConfigureAppDialogProps {
  configBaseDir: string;
  appSettings: any;
  action: ActionState;
  onSave: (baseDir: string) => void;
  onCancel: () => void;
}

export function ConfigureAppDialog({
  configBaseDir: initialDir,
  appSettings,
  action,
  onSave,
  onCancel,
}: ConfigureAppDialogProps) {
  const [baseDir, setBaseDir] = useState(initialDir);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", padding: "24px" }}
      >
        <h3>Configurar Aplicação</h3>
        <p style={{ color: "#666", marginBottom: "20px" }}>
          Escolha onde os arquivos (vídeos, shorts e transcrições) serão armazenados no seu
          computador.
        </p>

        {/* Native Folder Picker */}
        <button
          onClick={async () => {
            try {
              const result = await selectFolder();
              if (result.selected && result.path) {
                setBaseDir(result.path);
              }
            } catch (error) {
              console.error("Erro ao abrir seletor de pasta:", error);
            }
          }}
          style={{
            width: "100%",
            padding: "16px",
            marginBottom: "25px",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            border: "none",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: "700",
            fontSize: "1.1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
            transition: "all 0.3s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 12px rgba(0, 0, 0, 0.15)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
          }}
        >
          📂 Selecionar Pasta
        </button>

        {/* Manual Path Input */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
            📝 Ou digite o caminho manualmente
          </label>
          <input
            type="text"
            value={baseDir}
            onChange={(e) => setBaseDir(e.target.value)}
            placeholder="Ex: C:\\Users\\seu_usuario\\Documents\\YouTubeShorts"
            style={{
              width: "100%",
              padding: "10px",
              border: "1px solid #ddd",
              borderRadius: "4px",
              boxSizing: "border-box",
              marginBottom: "8px",
              fontFamily: "monospace",
              fontSize: "0.9rem",
            }}
          />
          <p style={{ color: "#999", fontSize: "0.8rem" }}>
            📍 Caminho atual: {appSettings?.media.base_dir}
          </p>
        </div>

        {/* Structure Preview */}
        <div
          style={{
            marginBottom: "20px",
            padding: "12px",
            background: "#f0f4ff",
            borderRadius: "6px",
          }}
        >
          <p style={{ color: "#333", fontSize: "0.9rem", margin: "0 0 8px 0" }}>
            <strong>📂 Estrutura que será criada:</strong>
          </p>
          <p
            style={{
              color: "#666",
              fontSize: "0.8rem",
              margin: "0",
              fontFamily: "monospace",
              lineHeight: "1.6",
            }}
          >
            {baseDir || "pasta_base"}/<br />
            ├── 🎬 videos/
            <br />
            ├── 🎞️ shorts/
            <br />
            └── 📄 transcrições/
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
          <button onClick={onCancel}>Cancelar</button>
          <button
            className="primary"
            disabled={action.busy || !baseDir.trim()}
            onClick={() => {
              if (baseDir.trim()) {
                onSave(baseDir);
              }
            }}
          >
            Salvar Configurações
          </button>
        </div>
      </div>
    </div>
  );
}
