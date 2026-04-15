import { useState } from "react";
import { selectFolder } from "../api";
import type { ActionState } from "../hooks/useAppAction";
import { AppButton, AppCheckboxField, AppDialog, AppInput, AppSelect } from "./shared";

interface ConfigureAppDialogProps {
  configBaseDir: string;
  configDownloadResolution: string;
  appSettings: any;
  action: ActionState;
  onSave: (
    baseDir: string,
    resolution: "1080p" | "1440p" | "4k",
    askDeleteCutConfirm: boolean,
  ) => void;
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
  const [askDeleteCutConfirm, setAskDeleteCutConfirm] = useState<boolean>(
    appSettings?.preferences?.ask_delete_cut_confirm ?? true,
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
      onSave(baseDir, resolution, askDeleteCutConfirm);
    }
  };

  return (
    <AppDialog
      title="Configurar Aplicação"
      onClose={onCancel}
      showHeaderClose={false}
      scrollable
      footer={
        <>
          <AppButton variant="primary" onClick={onCancel}>
            Cancelar
          </AppButton>
          <AppButton
            variant="secondary"
            disabled={action.busy || !baseDir.trim()}
            onClick={handleSave}
          >
            Salvar Configurações
          </AppButton>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: "20px" }}>
        Escolha onde os arquivos (vídeos, shorts e transcrições) serão armazenados no seu
        computador.
      </p>

      <AppButton
        onClick={handlePickFolder}
        variant="primary"
        fullWidth
        style={{ marginBottom: "20px" }}
      >
        Selecionar Pasta
      </AppButton>

      <label className="field">
        Ou digite o caminho manualmente
        <AppInput
          type="text"
          value={baseDir}
          onChange={(e) => setBaseDir(e.target.value)}
          placeholder="Ex: C:\\Users\\seu_usuario\\Documents\\YouTubeShorts"
          fullWidth
          style={{ fontFamily: "monospace", fontSize: "0.9rem" }}
        />
      </label>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-4px", marginBottom: "20px" }}>
        Caminho atual: {appSettings?.media.base_dir}
      </p>

      <label className="field">
        Resolução de download
        <AppSelect
          value={resolution}
          onChange={(e) => setResolution(e.target.value as "1080p" | "1440p" | "4k")}
          fullWidth
        >
          <option value="1080p">1080p (padrao)</option>
          <option value="1440p">1440p</option>
          <option value="4k">4k</option>
        </AppSelect>
      </label>
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-4px", marginBottom: "20px" }}>
        Resolução atual: {appSettings?.media.download_resolution || "1080p"}
      </p>

      <AppCheckboxField
        label="Habilitar mensagem ao apagar corte"
        checked={askDeleteCutConfirm}
        onChange={setAskDeleteCutConfirm}
        labelFontSize="0.88rem"
      />
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "-4px", marginBottom: "20px" }}>
        Estado atual:{" "}
        {appSettings?.preferences?.ask_delete_cut_confirm === false ? "Desabilitado" : "Habilitado"}
      </p>

      <div className="info-box light">
        <p className="info-box-title" style={{ margin: 0 }}>
          <strong>Estrutura que será criada:</strong>
        </p>
        <p
          className="muted"
          style={{
            margin: "8px 0 0",
            fontFamily: "monospace",
            fontSize: "0.8rem",
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
    </AppDialog>
  );
}
