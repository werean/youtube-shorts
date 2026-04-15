import { useState } from "react";
import { selectFolder } from "../api";
import type { ActionState } from "../hooks/useAppAction";
import { AppButton, AppInput, AppSelect } from "./shared";

interface ConfigureAppDialogProps {
  configBaseDir: string;
  configDownloadResolution: string;
  appSettings: any;
  action: ActionState;
  onSave: (baseDir: string, resolution: "1080p" | "1440p" | "4k") => void;
  onCancel: () => void;
}

export function ConfigureAppDialog({
  configBaseDir: initialDir,
  configDownloadResolution: initialResolution,
  appSettings,
  action,
  onSave,
  onCancel,
}: ConfigureAppDialogProps) {
  const [baseDir, setBaseDir] = useState(initialDir);
  const [resolution, setResolution] = useState<"1080p" | "1440p" | "4k">(
    initialResolution as "1080p" | "1440p" | "4k",
  );

  const handlePickFolder = async () => {
    try {
      const result = await selectFolder();
      if (result.selected && result.path) {
        setBaseDir(result.path);
      }
    } catch (error) {
      console.error("Erro ao abrir seletor de pasta:", error);
    }
  };

  const handleSave = () => {
    if (baseDir.trim()) {
      onSave(baseDir, resolution);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", padding: "24px" }}
      >
        <h3>Configurar Aplicação</h3>
        <p style={{ color: "var(--muted)", marginBottom: "20px" }}>
          Escolha onde os arquivos (vídeos, shorts e transcrições) serão armazenados no seu
          computador.
        </p>

        {/* Native Folder Picker */}
        <AppButton
          onClick={handlePickFolder}
          variant="secondary"
          fullWidth
          style={{
            padding: "16px",
            marginBottom: "25px",
            fontWeight: "700",
            fontSize: "1.1rem",
            borderRadius: "10px",
          }}
        >
          Selecionar Pasta
        </AppButton>

        {/* Manual Path Input */}
        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
            Ou digite o caminho manualmente
          </label>
          <AppInput
            type="text"
            value={baseDir}
            onChange={(e) => setBaseDir(e.target.value)}
            placeholder="Ex: C:\\Users\\seu_usuario\\Documents\\YouTubeShorts"
            fullWidth
            style={{
              padding: "10px",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              boxSizing: "border-box",
              marginBottom: "8px",
              fontFamily: "monospace",
              fontSize: "0.9rem",
              backgroundColor: "var(--bg-contrast)",
              color: "var(--ink)",
            }}
          />
          <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
            Caminho atual: {appSettings?.media.base_dir}
          </p>
        </div>

        <div style={{ marginBottom: "20px" }}>
          <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
            Resolução de download
          </label>
          <AppSelect
            value={resolution}
            onChange={(e) => setResolution(e.target.value as "1080p" | "1440p" | "4k")}
            fullWidth
            style={{
              padding: "10px",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              boxSizing: "border-box",
              fontSize: "0.9rem",
              backgroundColor: "var(--bg-contrast)",
              color: "var(--ink)",
            }}
          >
            <option value="1080p">1080p (padrao)</option>
            <option value="1440p">1440p</option>
            <option value="4k">4k</option>
          </AppSelect>
          <p style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "6px" }}>
            Resolução atual: {appSettings?.media.download_resolution || "1080p"}
          </p>
        </div>

        {/* Structure Preview */}
        <div
          style={{
            marginBottom: "20px",
            padding: "12px",
            background: "var(--bg-contrast)",
            borderRadius: "6px",
            border: "1px solid var(--border)",
          }}
        >
          <p style={{ color: "var(--ink)", fontSize: "0.9rem", margin: "0 0 8px 0" }}>
            <strong>Estrutura que será criada:</strong>
          </p>
          <p
            style={{
              color: "var(--muted)",
              fontSize: "0.8rem",
              margin: "0",
              fontFamily: "monospace",
              lineHeight: "1.6",
            }}
          >
            {baseDir || "pasta_base"}/<br />
            ├── videos/
            <br />
            ├── shorts/
            <br />
            └── transcrições/
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <AppButton variant="secondary" onClick={onCancel} style={{ padding: "10px 20px" }}>
            Cancelar
          </AppButton>
          <AppButton
            variant="primary"
            disabled={action.busy || !baseDir.trim()}
            style={{ padding: "10px 20px", borderRadius: "8px" }}
            onClick={handleSave}
          >
            Salvar Configurações
          </AppButton>
        </div>
      </div>
    </div>
  );
}
