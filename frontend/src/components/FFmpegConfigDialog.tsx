import { useState, useMemo } from "react";
import type { ActionState } from "../hooks/useAppAction";
import {
  VIDEO_CODECS,
  AUDIO_CODECS,
  CONTAINER_FORMATS,
  NVENC_PRESETS,
  SOFTWARE_PRESETS,
} from "../types/ffmpeg";
import type { FFmpegConfig } from "../types/ffmpeg";
import {
  ConfigField,
  TextInput,
  SelectInput,
  Toggle,
  ConfigSection,
} from "./WhisperConfigComponents";
import { AppButton } from "./shared";

interface FFmpegConfigDialogProps {
  action: ActionState;
  initialConfig?: FFmpegConfig;
  onSave: (config: FFmpegConfig) => void;
  onCancel: () => void;
}

export function FFmpegConfigDialog({
  action,
  initialConfig,
  onSave,
  onCancel,
}: FFmpegConfigDialogProps) {
  // Basic options
  const [format, setFormat] = useState<string>(initialConfig?.format || "mp4");
  const [video_codec, setVideo_codec] = useState<string>(
    initialConfig?.video_codec || "h264_nvenc",
  );
  const [audio_codec, setAudio_codec] = useState<string>(initialConfig?.audio_codec || "aac");

  // Advanced options
  const [video_bitrate, setVideo_bitrate] = useState<string>(initialConfig?.video_bitrate || "");
  const [video_preset, setVideo_preset] = useState<string>(initialConfig?.video_preset || "p5");
  const [audio_bitrate, setAudio_bitrate] = useState<string>(initialConfig?.audio_bitrate || "");
  const [framerate, setFramerate] = useState<string>(initialConfig?.framerate || "");
  const [aspect_ratio, setAspect_ratio] = useState<string>(initialConfig?.aspect_ratio || "9:16");
  const [audio_sample_rate, setAudio_sample_rate] = useState<string>(
    initialConfig?.audio_sample_rate || "",
  );
  const [audio_channels, setAudio_channels] = useState<string>(initialConfig?.audio_channels || "");
  const [disable_video, setDisable_video] = useState(Boolean(initialConfig?.disable_video));
  const [disable_audio, setDisable_audio] = useState(Boolean(initialConfig?.disable_audio));
  const [disable_subtitle, setDisable_subtitle] = useState(
    Boolean(initialConfig?.disable_subtitle),
  );
  const [video_filter, setVideo_filter] = useState<string>(initialConfig?.video_filter || "");
  const [audio_filter, setAudio_filter] = useState<string>(initialConfig?.audio_filter || "");
  const [metadata, setMetadata] = useState<string>(initialConfig?.metadata || "");

  // UI State
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSave = () => {
    const config: FFmpegConfig = {
      format: format || undefined,
      video_codec: video_codec || undefined,
      audio_codec: audio_codec || undefined,
      video_bitrate: video_bitrate || undefined,
      video_preset: video_preset || undefined,
      audio_bitrate: audio_bitrate || undefined,
      framerate: framerate || undefined,
      aspect_ratio: aspect_ratio || undefined,
      audio_sample_rate: audio_sample_rate || undefined,
      audio_channels: audio_channels || undefined,
      disable_video,
      disable_audio,
      disable_subtitle,
      video_filter: video_filter || undefined,
      audio_filter: audio_filter || undefined,
      metadata: metadata || undefined,
    };
    onSave(config);
  };

  const ffmpegCommand = useMemo(() => {
    const parts: string[] = ["ffmpeg", "-i", '"input.mp4"'];

    if (format) parts.push(`-f ${format}`);
    if (video_codec) parts.push(`-c:v ${video_codec}`);
    if (video_preset) parts.push(`-preset ${video_preset}`);
    if (audio_codec) parts.push(`-c:a ${audio_codec}`);
    if (video_bitrate) parts.push(`-b:v ${video_bitrate}`);
    if (audio_bitrate) parts.push(`-b:a ${audio_bitrate}`);
    if (framerate) parts.push(`-r ${framerate}`);
    if (aspect_ratio) parts.push(`-aspect ${aspect_ratio}`);
    if (audio_sample_rate) parts.push(`-ar ${audio_sample_rate}`);
    if (audio_channels) parts.push(`-ac ${audio_channels}`);
    if (disable_video) parts.push("-vn");
    if (disable_audio) parts.push("-an");
    if (disable_subtitle) parts.push("-sn");
    if (video_filter) parts.push(`-vf '${video_filter}'`);
    if (audio_filter) parts.push(`-af '${audio_filter}'`);
    if (metadata) parts.push(`-metadata '${metadata}'`);

    parts.push('"output.mp4"');
    return parts.join(" ");
  }, [
    format,
    video_codec,
    video_preset,
    audio_codec,
    video_bitrate,
    audio_bitrate,
    framerate,
    aspect_ratio,
    audio_sample_rate,
    audio_channels,
    disable_video,
    disable_audio,
    disable_subtitle,
    video_filter,
    audio_filter,
    metadata,
  ]);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "1100px", width: "95vw" }}
      >
        <div className="dialog-header">
          <h3>Configurar FFmpeg</h3>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          {/* Basic Options Section */}
          <ConfigSection title="Opções Básicas">
            <ConfigField
              label="Formato"
              description="Tipo de arquivo de saída"
              tooltip="mp4 é padrão e compatível. mkv suporta mais recursos. mov para Apple. webm para web. Deixe vazio para detectar pela extensão."
            >
              <SelectInput
                value={format}
                onChange={setFormat}
                options={CONTAINER_FORMATS.map((f) => ({ label: f.label, value: f.id }))}
              />
            </ConfigField>

            <ConfigField
              label="Preset de vídeo"
              description="Velocidade de codificação vs qualidade"
              tooltip="NVIDIA NVENC: p1-p7 (p1 rápido, p7 qualidade). Padrão: p5. Software: faster/fast/medium/slow/slower."
            >
              <SelectInput
                value={video_preset}
                onChange={setVideo_preset}
                options={
                  video_codec?.includes("nvenc")
                    ? NVENC_PRESETS.map((p) => ({ label: p.label, value: p.id }))
                    : SOFTWARE_PRESETS.map((p) => ({ label: p.label, value: p.id }))
                }
              />
            </ConfigField>

            <ConfigField
              label="Codec de áudio"
              tooltip="aac é compatível. mp3 é antigo. opus é melhor qualidade. Deixe vazio para manter original."
            >
              <SelectInput
                value={audio_codec}
                onChange={setAudio_codec}
                options={AUDIO_CODECS.map((c) => ({ label: c.label, value: c.id }))}
              />
            </ConfigField>
          </ConfigSection>

          {/* Advanced Settings Toggle */}
          <div
            style={{
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <AppButton
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 16px",
                backgroundColor: "var(--bg-contrast)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "14px",
                color: "var(--ink)",
                width: "100%",
                justifyContent: "space-between",
              }}
            >
              <span>Configurações Avançadas</span>
              <span
                style={{
                  transform: showAdvanced ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.3s ease",
                }}
              >
                ▼
              </span>
            </AppButton>
          </div>

          {/* Advanced Sections */}
          {showAdvanced && (
            <>
              {/* Quality Options */}
              <ConfigSection title="Qualidade e Taxa de Bits">
                <ConfigField
                  label="Taxa de bits de vídeo"
                  description="Quanto dados o vídeo ocupa (qualidade)"
                  tooltip="Define a qualidade/tamanho do vídeo. 1000k = 1 Mbps. 5M = 5 Mbps. Maior = melhor qualidade mas arquivo maior. Deixe vazio para padrão."
                >
                  <TextInput
                    value={video_bitrate}
                    onChange={setVideo_bitrate}
                    placeholder="1000k, 5M, etc"
                  />
                </ConfigField>

                <ConfigField
                  label="Taxa de bits de áudio"
                  description="Qualidade do som"
                  tooltip="128k = rádio. 192k = qualidade boa. 256k = máxima. Deixe vazio para padrão do codec escolhido."
                >
                  <TextInput
                    value={audio_bitrate}
                    onChange={setAudio_bitrate}
                    placeholder="128k, 192k, etc"
                  />
                </ConfigField>
              </ConfigSection>

              {/* Video Advanced */}
              <ConfigSection title="Opções de Vídeo">
                <ConfigField
                  label="Taxa de quadros"
                  description="Quantas imagens por segundo"
                  tooltip="24 = cinema. 30 = TV normal. 60 = gaming/ação. Deixe vazio para manter original (geralmente 30)."
                >
                  <TextInput value={framerate} onChange={setFramerate} placeholder="24, 30, 60" />
                </ConfigField>

                <ConfigField
                  label="Proporção de tela"
                  description="Formato da imagem"
                  tooltip="16:9 = tela larga. 4:3 = antigo. 1:1 = quadrado. Deixe vazio para manter original."
                >
                  <TextInput
                    value={aspect_ratio}
                    onChange={setAspect_ratio}
                    placeholder="16:9, 4:3, 1:1"
                  />
                </ConfigField>

                <ConfigField
                  label="Remover vídeo"
                  description="Extrair apenas o áudio"
                  tooltip="Se ligado, remove o vídeo e mantém apenas a trilha sonora."
                >
                  <Toggle checked={disable_video} onChange={setDisable_video} />
                </ConfigField>

                <ConfigField
                  label="Filtro de vídeo"
                  description="Efeitos e transformações"
                  tooltip="Exemplos: 'scale=1920:1080' (redimensionar), 'rotate=90' (girar 90°), 'crop=1280:720'. Deixe vazio para nenhum."
                >
                  <TextInput
                    value={video_filter}
                    onChange={setVideo_filter}
                    placeholder="scale, rotate, crop, etc"
                  />
                </ConfigField>
              </ConfigSection>

              {/* Audio Advanced */}
              <ConfigSection title="Opções de Áudio">
                <ConfigField
                  label="Taxa de amostragem"
                  description="Frequência do som (som é medido em amostras)"
                  tooltip="44100 Hz = CD. 48000 = vídeo profissional. 96000 = Hi-Fi. Deixe vazio para padrão (48000)."
                >
                  <TextInput
                    value={audio_sample_rate}
                    onChange={setAudio_sample_rate}
                    placeholder="44100, 48000, 96000"
                  />
                </ConfigField>

                <ConfigField
                  label="Canais de áudio"
                  description="Número de linhas de som"
                  tooltip="1 = mono (um canal). 2 = estéreo (esquerda/direita). 6 = surround 5.1. Deixe vazio para manter original."
                >
                  <TextInput
                    value={audio_channels}
                    onChange={setAudio_channels}
                    placeholder="1, 2, 6"
                  />
                </ConfigField>

                <ConfigField
                  label="Remover áudio"
                  description="Remover a trilha sonora"
                  tooltip="Se ligado, mantém apenas o vídeo mudo (sem som)."
                >
                  <Toggle checked={disable_audio} onChange={setDisable_audio} />
                </ConfigField>

                <ConfigField
                  label="Filtro de áudio"
                  description="Efeitos de som"
                  tooltip="Exemplos: 'volume=0.5' (diminuir metade), 'volume=2' (dobrar), 'bass=10'. Deixe vazio para nenhum."
                >
                  <TextInput
                    value={audio_filter}
                    onChange={setAudio_filter}
                    placeholder="volume, bass, treble, etc"
                  />
                </ConfigField>
              </ConfigSection>

              {/* Metadata & Other */}
              <ConfigSection title="Outros">
                <ConfigField
                  label="Remover legendas"
                  description="Não incluir legendas no arquivo"
                  tooltip="Se ligado, remove qualquer legenda do arquivo de entrada."
                >
                  <Toggle checked={disable_subtitle} onChange={setDisable_subtitle} />
                </ConfigField>

                <ConfigField
                  label="Metadados"
                  description="Informações sobre o arquivo"
                  tooltip="Exemplos: 'title=Meu Vídeo', 'artist=Seu Nome'. Use aspas duplas se tiver espaços. Use '&' para separar múltiplos valores."
                >
                  <TextInput
                    value={metadata}
                    onChange={setMetadata}
                    placeholder="title=Meu Vídeo&artist=Autor"
                  />
                </ConfigField>
              </ConfigSection>
            </>
          )}

          {/* Command Preview */}
          <div
            style={{
              marginTop: "32px",
              padding: "16px",
              backgroundColor: "var(--bg-contrast)",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: "var(--muted)",
                marginBottom: "8px",
              }}
            >
              Comando FFmpeg (Prévia)
            </div>
            <div
              style={{
                backgroundColor: "var(--bg)",
                color: "var(--ink)",
                padding: "12px",
                borderRadius: "6px",
                fontFamily: "monospace",
                fontSize: "12px",
                lineHeight: "1.5",
                overflowX: "auto",
                wordBreak: "break-word",
              }}
            >
              {ffmpegCommand}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: "var(--muted)",
                marginTop: "8px",
                fontStyle: "italic",
              }}
            >
              Este comando será executado com seus arquivos de entrada
            </div>
          </div>

          {/* Action Buttons */}
          <div
            style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "24px" }}
          >
            <AppButton
              onClick={onCancel}
              variant="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Cancelar
            </AppButton>
            <AppButton
              onClick={handleSave}
              disabled={action.busy}
              variant="secondary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
              }}
            >
              Salvar Configurações
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  );
}

