import {
  CaretDown,
  Crop,
  FrameCorners,
  Info,
  Lightning,
  MagnifyingGlassPlus,
  Medal,
  Play,
  Scales,
  SplitVertical,
  Subtitles,
  UserFocus,
  Waveform,
} from "@phosphor-icons/react";
import type { BatchPipelineOptions } from "@youtube-shorts/contracts";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AUDIO_CODECS,
  CONTAINER_FORMATS,
  NVENC_PRESETS,
  SOFTWARE_PRESETS,
  VIDEO_CODECS,
  type FFmpegConfig,
} from "../../../types/ffmpeg";
import {
  FormatChip,
  GhostButton,
  PickTile,
  PickTileGroup,
  SettingsSectionLabel,
  SettingsSwitch,
  StatusDot,
  type AutoSaveReporter,
  type StatusTone,
} from "./settingsShared";

/* -------------------------------------------------------------------------- */
/* Utilitários internos                                                        */
/* -------------------------------------------------------------------------- */

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function normalizeFFmpegConfig(config: FFmpegConfig | null | undefined): FFmpegConfig {
  const base: Record<string, unknown> = config ? { ...config } : {};
  const burnSubtitles = config?.burn_subtitles ?? !Boolean(config?.disable_subtitle);
  return {
    ...(base as Partial<FFmpegConfig>),
    format: config?.format || "mp4",
    video_codec: config?.video_codec || "h264_nvenc",
    audio_codec: config?.audio_codec || "aac",
    video_bitrate: config?.video_bitrate || undefined,
    video_preset: config?.video_preset || "p5",
    audio_bitrate: config?.audio_bitrate || undefined,
    framerate: config?.framerate || undefined,
    aspect_ratio: config ? config.aspect_ratio || undefined : "9:16",
    audio_sample_rate: config?.audio_sample_rate || undefined,
    audio_channels: config?.audio_channels || undefined,
    disable_video: Boolean(config?.disable_video),
    disable_audio: Boolean(config?.disable_audio),
    disable_subtitle: config?.disable_subtitle ?? !burnSubtitles,
    video_filter: config?.video_filter || undefined,
    audio_filter: config?.audio_filter || undefined,
    metadata: config?.metadata || undefined,
    vertical_mode: config?.vertical_mode || "auto_reframe",
    burn_subtitles: burnSubtitles,
    subtitle_style: config?.subtitle_style || "word_highlight",
    normalize_audio: config?.normalize_audio ?? true,
    trim_internal_silence: Boolean(config?.trim_internal_silence),
  };
}

async function persistFFmpegConfig(
  onSaveFFmpeg: (config: FFmpegConfig) => Promise<void> | void,
  config: FFmpegConfig,
  reporter?: AutoSaveReporter,
): Promise<boolean> {
  reporter?.reportSaving();
  try {
    await onSaveFFmpeg(config);
    reporter?.reportSaved();
    return true;
  } catch (error) {
    reporter?.reportError(errorMessage(error));
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Tela 10 — Renderização › Qualidade (ffmpeg-quality)                         */
/* -------------------------------------------------------------------------- */

export interface FFmpegSectionProps {
  ffmpegConfig: FFmpegConfig | null;
  onSaveFFmpeg: (config: FFmpegConfig) => Promise<void> | void;
  reporter?: AutoSaveReporter;
}

export type FFmpegQualitySectionProps = FFmpegSectionProps;

interface QualityPresetTile {
  id: "p1" | "p5" | "p7";
  title: string;
  description: string;
  icon: ReactNode;
}

const QUALITY_PRESETS: QualityPresetTile[] = [
  {
    id: "p1",
    title: "Rápido",
    description: "Velocidade máxima, menor qualidade.",
    icon: <Lightning size={16} />,
  },
  {
    id: "p5",
    title: "Equilibrado",
    description: "Qualidade boa com velocidade equilibrada. Padrão do sistema.",
    icon: <Scales size={16} />,
  },
  {
    id: "p7",
    title: "Máxima qualidade",
    description: "Qualidade máxima, leva mais tempo.",
    icon: <Medal size={16} />,
  },
];

const QUALITY_CHIP_ORDER = ["mp4", "mkv", "mov", "webm", "avi", "flv", "m3u8"] as const;

const QUALITY_CHIP_SHORT_LABELS: Record<string, string> = {
  mp4: "MP4",
  mkv: "MKV",
  mov: "MOV",
  webm: "WebM",
  avi: "AVI",
  flv: "FLV",
  m3u8: "M3U8 (HLS)",
};

export function FFmpegQualitySection({
  ffmpegConfig,
  onSaveFFmpeg,
  reporter,
}: FFmpegQualitySectionProps) {
  const normalized = useMemo(() => normalizeFFmpegConfig(ffmpegConfig), [ffmpegConfig]);
  const [videoPreset, setVideoPreset] = useState<string>(normalized.video_preset || "p5");
  const [format, setFormat] = useState<string>(normalized.format || "mp4");

  useEffect(() => {
    setVideoPreset(normalized.video_preset || "p5");
    setFormat(normalized.format || "mp4");
  }, [normalized.video_preset, normalized.format]);

  const orderedFormats = useMemo(() => {
    const byId = new Map(CONTAINER_FORMATS.map((item) => [item.id, item]));
    const ordered = QUALITY_CHIP_ORDER.map((id) => byId.get(id)).filter(
      (item): item is (typeof CONTAINER_FORMATS)[number] => Boolean(item),
    );
    for (const item of CONTAINER_FORMATS) {
      if (!ordered.some((existing) => existing.id === item.id)) {
        ordered.push(item);
      }
    }
    return ordered;
  }, []);

  async function handleSelectPreset(nextPreset: string): Promise<void> {
    if (nextPreset === videoPreset) return;
    const prevPreset = videoPreset;
    setVideoPreset(nextPreset);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      format,
      video_preset: nextPreset,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setVideoPreset(prevPreset);
    }
  }

  async function handleSelectFormat(nextFormat: string): Promise<void> {
    if (nextFormat === format) return;
    const prevFormat = format;
    setFormat(nextFormat);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      format: nextFormat,
      video_preset: videoPreset,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setFormat(prevFormat);
    }
  }

  const [displayedFormat, setDisplayedFormat] = useState<string>(format);
  const [helperVisible, setHelperVisible] = useState<boolean>(true);

  useEffect(() => {
    if (format === displayedFormat) {
      setHelperVisible(true);
      return;
    }
    setHelperVisible(false);
    const timer = setTimeout(() => {
      setDisplayedFormat(format);
      setHelperVisible(true);
    }, 110);
    return () => clearTimeout(timer);
  }, [format, displayedFormat]);

  const activeFormatMeta = useMemo(
    () => CONTAINER_FORMATS.find((item) => item.id === displayedFormat),
    [displayedFormat],
  );

  const formatHelperText =
    displayedFormat === "mp4"
      ? "MP4 é o padrão universal e funciona em qualquer rede social."
      : activeFormatMeta
        ? `${activeFormatMeta.label}: ${activeFormatMeta.description}.`
        : "Formato personalizado para os arquivos renderizados.";

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SettingsSectionLabel>QUALIDADE DO CORTE</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {QUALITY_PRESETS.map((preset) => {
            const isSelected = videoPreset === preset.id;
            return (
              <PickTile
                key={preset.id}
                selected={isSelected}
                onSelect={() => void handleSelectPreset(preset.id)}
                actionLabel="Usar este nível"
                ariaLabel={`${preset.title} — ${preset.description}`}
                className="min-h-[148px]"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-item bg-glass-hover text-text-2"
                >
                  {preset.icon}
                </span>
                <span className="mt-3 text-md font-medium text-text-1">{preset.title}</span>
                <span className="mt-1 text-sm leading-relaxed text-text-3">
                  {preset.description}
                </span>
              </PickTile>
            );
          })}
        </PickTileGroup>
        <p className="mt-3 text-sm text-text-3">
          Os cortes saem em 9:16 vertical, codificados na placa de vídeo NVIDIA.
        </p>
      </section>

      <section>
        <SettingsSectionLabel>FORMATO DO ARQUIVO</SettingsSectionLabel>
        <div className="flex flex-wrap items-center gap-2">
          {orderedFormats.map((item) => (
            <FormatChip
              key={item.id}
              label={QUALITY_CHIP_SHORT_LABELS[item.id] ?? item.label}
              selected={format === item.id}
              onToggle={() => void handleSelectFormat(item.id)}
            />
          ))}
        </div>
        <p
          className={`mt-3 min-h-[20px] text-sm text-text-3 transition-opacity ease-out ${
            helperVisible ? "duration-[220ms] opacity-100" : "duration-[110ms] opacity-0"
          }`}
        >
          {formatHelperText}
        </p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela — Renderização › Visual do corte (ffmpeg-visual)                       */
/* -------------------------------------------------------------------------- */

export type FFmpegVisualSectionProps = FFmpegSectionProps;

type VerticalModeId = NonNullable<FFmpegConfig["vertical_mode"]>;
type SubtitleStyleId = NonNullable<FFmpegConfig["subtitle_style"]>;

interface VerticalModeTileMeta {
  id: VerticalModeId;
  title: string;
  description: string;
  icon: ReactNode;
}

const VERTICAL_MODE_TILES: VerticalModeTileMeta[] = [
  {
    id: "auto_reframe",
    title: "Enquadramento automático",
    description: "Segue rostos e falantes automaticamente no enquadramento 9:16 (padrão).",
    icon: <UserFocus size={16} />,
  },
  {
    id: "blur",
    title: "Fundo desfocado",
    description:
      "Mantém o quadro 16:9 centralizado com fundo desfocado suave atrás (ideal para slides/gameplay/tela).",
    icon: <FrameCorners size={16} />,
  },
  {
    id: "zoom",
    title: "Zoom centralizado",
    description: "Preenche o 9:16 dando zoom no centro da imagem.",
    icon: <MagnifyingGlassPlus size={16} />,
  },
  {
    id: "crop",
    title: "Recorte central fixo",
    description: "Corta as laterais sem câmera virtual dinâmica.",
    icon: <Crop size={16} />,
  },
  {
    id: "split_podcast",
    title: "Dividir em 2 rostos (Podcast)",
    description: "Empilha dois falantes em tela dividida quando há duas pessoas.",
    icon: <SplitVertical size={16} />,
  },
];

const SUBTITLE_STYLE_TILES: ReadonlyArray<{
  id: SubtitleStyleId;
  title: string;
  description: string;
}> = [
  {
    id: "word_highlight",
    title: "Destaque palavra por palavra",
    description: "Destaca cada palavra no ritmo exato da fala para prender atenção no feed.",
  },
  {
    id: "sentence",
    title: "Frase completa",
    description: "Exibe a frase inteira de forma contínua e discreta na tela.",
  },
];

export function FFmpegVisualSection({
  ffmpegConfig,
  onSaveFFmpeg,
  reporter,
}: FFmpegVisualSectionProps) {
  const normalized = useMemo(() => normalizeFFmpegConfig(ffmpegConfig), [ffmpegConfig]);
  const [verticalMode, setVerticalMode] = useState<VerticalModeId>(
    normalized.vertical_mode || "auto_reframe",
  );
  const [burnSubtitles, setBurnSubtitles] = useState<boolean>(
    normalized.burn_subtitles ?? !normalized.disable_subtitle,
  );
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleId>(
    normalized.subtitle_style || "word_highlight",
  );
  const [trimInternalSilence, setTrimInternalSilence] = useState<boolean>(
    Boolean(normalized.trim_internal_silence),
  );
  const [normalizeAudio, setNormalizeAudio] = useState<boolean>(
    normalized.normalize_audio ?? true,
  );

  const burnSubtitlesTitleId = useId();
  const burnSubtitlesDescId = useId();
  const trimSilenceTitleId = useId();
  const trimSilenceDescId = useId();
  const normalizeAudioTitleId = useId();
  const normalizeAudioDescId = useId();

  useEffect(() => {
    setVerticalMode(normalized.vertical_mode || "auto_reframe");
    setBurnSubtitles(normalized.burn_subtitles ?? !normalized.disable_subtitle);
    setSubtitleStyle(normalized.subtitle_style || "word_highlight");
    setTrimInternalSilence(Boolean(normalized.trim_internal_silence));
    setNormalizeAudio(normalized.normalize_audio ?? true);
  }, [
    normalized.vertical_mode,
    normalized.burn_subtitles,
    normalized.disable_subtitle,
    normalized.subtitle_style,
    normalized.trim_internal_silence,
    normalized.normalize_audio,
  ]);

  async function handleSelectVerticalMode(nextMode: VerticalModeId): Promise<void> {
    if (nextMode === verticalMode) return;
    const prevMode = verticalMode;
    setVerticalMode(nextMode);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      vertical_mode: nextMode,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setVerticalMode(prevMode);
    }
  }

  async function handleToggleBurnSubtitles(nextBurn: boolean): Promise<void> {
    const prevBurn = burnSubtitles;
    setBurnSubtitles(nextBurn);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      burn_subtitles: nextBurn,
      disable_subtitle: !nextBurn,
      subtitle_style: subtitleStyle,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setBurnSubtitles(prevBurn);
    }
  }

  async function handleSelectSubtitleStyle(nextStyle: SubtitleStyleId): Promise<void> {
    if (nextStyle === subtitleStyle) return;
    const prevStyle = subtitleStyle;
    setSubtitleStyle(nextStyle);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      burn_subtitles: burnSubtitles,
      disable_subtitle: !burnSubtitles,
      subtitle_style: nextStyle,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setSubtitleStyle(prevStyle);
    }
  }

  async function handleToggleTrimSilence(nextTrim: boolean): Promise<void> {
    const prevTrim = trimInternalSilence;
    setTrimInternalSilence(nextTrim);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      trim_internal_silence: nextTrim,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setTrimInternalSilence(prevTrim);
    }
  }

  async function handleToggleNormalizeAudio(nextNormalize: boolean): Promise<void> {
    const prevNormalize = normalizeAudio;
    setNormalizeAudio(nextNormalize);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      normalize_audio: nextNormalize,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setNormalizeAudio(prevNormalize);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SettingsSectionLabel>ENQUADRAMENTO VERTICAL (9:16)</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERTICAL_MODE_TILES.map((mode) => (
            <PickTile
              key={mode.id}
              selected={verticalMode === mode.id}
              onSelect={() => void handleSelectVerticalMode(mode.id)}
              ariaLabel={`${mode.title} — ${mode.description}`}
              className="min-h-[132px]"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-item bg-glass-hover text-text-2"
              >
                {mode.icon}
              </span>
              <span className="mt-3 text-base font-semibold text-text-1">{mode.title}</span>
              <span className="mt-1 text-xs leading-relaxed text-text-3">{mode.description}</span>
            </PickTile>
          ))}
        </PickTileGroup>
      </section>

      <section>
        <SettingsSectionLabel>LEGENDAS NO CORTE</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-glass px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item bg-[rgba(91,156,255,0.1)] text-accent-soft"
            >
              <Subtitles size={18} />
            </span>
            <div className="min-w-0">
              <p id={burnSubtitlesTitleId} className="text-base font-medium text-text-1">
                Embutir legendas no vídeo
              </p>
              <p id={burnSubtitlesDescId} className="mt-0.5 text-sm text-text-3">
                Grava as legendas sincronizadas diretamente na imagem do corte vertical.
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={burnSubtitles}
            onChange={(next) => void handleToggleBurnSubtitles(next)}
            ariaLabelledBy={burnSubtitlesTitleId}
            ariaDescribedBy={burnSubtitlesDescId}
          />
        </div>

        {burnSubtitles && (
          <PickTileGroup className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SUBTITLE_STYLE_TILES.map((style) => (
              <PickTile
                key={style.id}
                selected={subtitleStyle === style.id}
                onSelect={() => void handleSelectSubtitleStyle(style.id)}
                ariaLabel={`${style.title} — ${style.description}`}
                className="min-h-[96px]"
              >
                <span className="text-base font-semibold text-text-1">{style.title}</span>
                <span className="mt-1 text-xs leading-relaxed text-text-3">
                  {style.description}
                </span>
              </PickTile>
            ))}
          </PickTileGroup>
        )}
      </section>

      <section>
        <SettingsSectionLabel>ACABAMENTO AUTOMÁTICO</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-glass divide-y divide-line">
          <div className="px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={trimSilenceTitleId} className="text-base font-medium text-text-1">
                Remover silêncios internos longos
              </p>
              <p id={trimSilenceDescId} className="mt-0.5 text-sm text-text-3">
                Encurta pausas longas acima do limite dentro do corte para manter o ritmo fluido.
              </p>
            </div>
            <SettingsSwitch
              checked={trimInternalSilence}
              onChange={(next) => void handleToggleTrimSilence(next)}
              ariaLabelledBy={trimSilenceTitleId}
              ariaDescribedBy={trimSilenceDescId}
            />
          </div>

          <div className="px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={normalizeAudioTitleId} className="text-base font-medium text-text-1">
                Normalizar volume final (-14 LUFS)
              </p>
              <p id={normalizeAudioDescId} className="mt-0.5 text-sm text-text-3">
                Equilibra o volume para o padrão de redes sociais.
              </p>
            </div>
            <SettingsSwitch
              checked={normalizeAudio}
              onChange={(next) => void handleToggleNormalizeAudio(next)}
              ariaLabelledBy={normalizeAudioTitleId}
              ariaDescribedBy={normalizeAudioDescId}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 11 — Renderização › Áudio (ffmpeg-audio)                               */
/* -------------------------------------------------------------------------- */

export type FFmpegAudioSectionProps = FFmpegSectionProps;

interface AudioCodecTileMeta {
  id: string;
  title: string;
  description: string;
}

const AUDIO_CODEC_TILES: AudioCodecTileMeta[] = [
  { id: "aac", title: "AAC", description: "Padrão, compatível" },
  { id: "opus", title: "Opus", description: "Melhor qualidade, moderno" },
  { id: "mp3", title: "MP3", description: "Compatível, antigo" },
  { id: "flac", title: "FLAC", description: "Sem perda de qualidade" },
  { id: "pcm", title: "WAV (PCM)", description: "Sem compressão, muito pesado" },
  { id: "libvorbis", title: "Vorbis", description: "Boa qualidade, código aberto" },
];

export function FFmpegAudioSection({
  ffmpegConfig,
  onSaveFFmpeg,
  reporter,
}: FFmpegAudioSectionProps) {
  const normalized = useMemo(() => normalizeFFmpegConfig(ffmpegConfig), [ffmpegConfig]);
  const [audioCodec, setAudioCodec] = useState<string>(normalized.audio_codec || "aac");
  const [disableAudio, setDisableAudio] = useState<boolean>(normalized.disable_audio);
  const [disableVideo, setDisableVideo] = useState<boolean>(normalized.disable_video);
  const [normalizeAudio, setNormalizeAudio] = useState<boolean>(
    normalized.normalize_audio ?? true,
  );
  const normalizeTitleId = useId();
  const normalizeDescId = useId();
  const switchTitleId = useId();
  const switchDescId = useId();
  const disableVideoTitleId = useId();
  const disableVideoDescId = useId();

  useEffect(() => {
    setAudioCodec(normalized.audio_codec || "aac");
    setDisableAudio(normalized.disable_audio);
    setDisableVideo(normalized.disable_video);
    setNormalizeAudio(normalized.normalize_audio ?? true);
  }, [
    normalized.audio_codec,
    normalized.disable_audio,
    normalized.disable_video,
    normalized.normalize_audio,
  ]);

  const codecTiles = useMemo(() => {
    const knownIds = new Set(AUDIO_CODECS.map((c) => c.id));
    return AUDIO_CODEC_TILES.filter((tile) => knownIds.has(tile.id));
  }, []);

  async function handleSelectAudioCodec(nextCodec: string): Promise<void> {
    if (nextCodec === audioCodec) return;
    const prevCodec = audioCodec;
    setAudioCodec(nextCodec);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      audio_codec: nextCodec,
      disable_audio: disableAudio,
      disable_video: disableVideo,
      normalize_audio: normalizeAudio,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setAudioCodec(prevCodec);
    }
  }

  async function handleToggleNormalizeAudio(nextNormalizeAudio: boolean): Promise<void> {
    const prevNormalizeAudio = normalizeAudio;
    setNormalizeAudio(nextNormalizeAudio);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      audio_codec: audioCodec,
      disable_audio: disableAudio,
      disable_video: disableVideo,
      normalize_audio: nextNormalizeAudio,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setNormalizeAudio(prevNormalizeAudio);
    }
  }

  async function handleToggleDisableAudio(nextDisableAudio: boolean): Promise<void> {
    const prevDisableAudio = disableAudio;
    setDisableAudio(nextDisableAudio);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      audio_codec: audioCodec,
      disable_audio: nextDisableAudio,
      disable_video: disableVideo,
      normalize_audio: normalizeAudio,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setDisableAudio(prevDisableAudio);
    }
  }

  async function handleToggleDisableVideo(nextDisableVideo: boolean): Promise<void> {
    const prevDisableVideo = disableVideo;
    setDisableVideo(nextDisableVideo);
    const nextConfig: FFmpegConfig = {
      ...normalized,
      audio_codec: audioCodec,
      disable_audio: disableAudio,
      disable_video: nextDisableVideo,
      normalize_audio: normalizeAudio,
    };
    const ok = await persistFFmpegConfig(onSaveFFmpeg, nextConfig, reporter);
    if (!ok) {
      setDisableVideo(prevDisableVideo);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SettingsSectionLabel>CODEC DE ÁUDIO</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {codecTiles.map((codec) => (
            <PickTile
              key={codec.id}
              selected={audioCodec === codec.id}
              onSelect={() => void handleSelectAudioCodec(codec.id)}
              ariaLabel={`${codec.title} — ${codec.description}`}
              className="min-h-[78px]"
            >
              <span className="text-base font-semibold text-text-1">{codec.title}</span>
              <span className="mt-1 text-sm text-text-3">{codec.description}</span>
            </PickTile>
          ))}
        </PickTileGroup>
      </section>

      <section>
        <SettingsSectionLabel>VOLUME</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-white/[0.015] p-4 flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-item text-accent-soft bg-[rgba(91,156,255,0.1)]"
            >
              <Waveform size={18} />
            </span>
            <div className="min-w-0">
              <p id={normalizeTitleId} className="text-base font-medium text-text-1">
                Volume nivelado em −14 LUFS
              </p>
              <p id={normalizeDescId} className="mt-0.5 text-sm text-text-3">
                {normalizeAudio
                  ? "Aplicado automaticamente nos cortes verticais para padrão de redes sociais."
                  : "Normalização desativada; mantém o ganho original da gravação."}
              </p>
            </div>
          </div>
          <SettingsSwitch
            checked={normalizeAudio}
            onChange={(next) => void handleToggleNormalizeAudio(next)}
            ariaLabelledBy={normalizeTitleId}
            ariaDescribedBy={normalizeDescId}
          />
        </div>
      </section>

      <section>
        <SettingsSectionLabel>TRILHA SONORA</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-glass divide-y divide-line">
          <div className="px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={switchTitleId} className="text-base font-medium text-text-1">
                Remover áudio
              </p>
              <p id={switchDescId} className="mt-0.5 text-sm text-text-3">
                Gera o corte sem a trilha sonora.
              </p>
            </div>
            <SettingsSwitch
              checked={disableAudio}
              onChange={(next) => void handleToggleDisableAudio(next)}
              ariaLabelledBy={switchTitleId}
              ariaDescribedBy={switchDescId}
            />
          </div>

          <div className="px-4 py-3.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p id={disableVideoTitleId} className="text-base font-medium text-text-1">
                Remover vídeo
              </p>
              <p id={disableVideoDescId} className="mt-0.5 text-sm text-text-3">
                Exporta apenas a faixa de áudio (MP3/AAC), descartando a imagem do vídeo — útil para
                podcasts em áudio.
              </p>
            </div>
            <SettingsSwitch
              checked={disableVideo}
              onChange={(next) => void handleToggleDisableVideo(next)}
              ariaLabelledBy={disableVideoTitleId}
              ariaDescribedBy={disableVideoDescId}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 12 — Renderização › Avançado (ffmpeg-advanced)                         */
/* -------------------------------------------------------------------------- */

export type FFmpegAdvancedSectionProps = FFmpegSectionProps;

interface AdvancedFormState {
  format: string;
  video_codec: string;
  video_preset: string;
  video_bitrate: string;
  framerate: string;
  aspect_ratio: string;
  video_filter: string;
  audio_codec: string;
  audio_bitrate: string;
  audio_sample_rate: string;
  audio_channels: string;
  audio_filter: string;
  metadata: string;
  disable_video: boolean;
  disable_audio: boolean;
  disable_subtitle: boolean;
}

function toAdvancedFormState(config: FFmpegConfig | null | undefined): AdvancedFormState {
  const normalized = normalizeFFmpegConfig(config);
  return {
    format: normalized.format ?? "mp4",
    video_codec: normalized.video_codec ?? "h264_nvenc",
    video_preset: normalized.video_preset ?? "p5",
    video_bitrate: normalized.video_bitrate ?? "",
    framerate: normalized.framerate ?? "",
    aspect_ratio: normalized.aspect_ratio ?? "",
    video_filter: normalized.video_filter ?? "",
    audio_codec: normalized.audio_codec ?? "aac",
    audio_bitrate: normalized.audio_bitrate ?? "",
    audio_sample_rate: normalized.audio_sample_rate ?? "",
    audio_channels: normalized.audio_channels ?? "",
    audio_filter: normalized.audio_filter ?? "",
    metadata: normalized.metadata ?? "",
    disable_video: normalized.disable_video,
    disable_audio: normalized.disable_audio,
    disable_subtitle: normalized.disable_subtitle,
  };
}

function serializeFFmpegConfig(config: FFmpegConfig | null | undefined): string {
  const normalized = normalizeFFmpegConfig(config);
  const entries = Object.entries(normalized)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function formStateToFFmpegConfig(
  state: AdvancedFormState,
  baseConfig?: FFmpegConfig | null,
): FFmpegConfig {
  const base = normalizeFFmpegConfig(baseConfig);
  return {
    ...base,
    format: state.format.trim() || undefined,
    video_codec: state.video_codec.trim() || undefined,
    audio_codec: state.audio_codec.trim() || undefined,
    video_bitrate: state.video_bitrate.trim() || undefined,
    video_preset: state.video_preset.trim() || undefined,
    audio_bitrate: state.audio_bitrate.trim() || undefined,
    framerate: state.framerate.trim() || undefined,
    aspect_ratio: state.aspect_ratio.trim() || undefined,
    audio_sample_rate: state.audio_sample_rate.trim() || undefined,
    audio_channels: state.audio_channels.trim() || undefined,
    disable_video: state.disable_video,
    disable_audio: state.disable_audio,
    disable_subtitle: state.disable_subtitle,
    burn_subtitles: !state.disable_subtitle,
    video_filter: state.video_filter.trim() || undefined,
    audio_filter: state.audio_filter.trim() || undefined,
    metadata: state.metadata.trim() || undefined,
  };
}

const FIELD_LABEL_CLASS = "block text-xs font-medium text-text-3 mb-1.5";
const TEXT_INPUT_CLASS =
  "w-full h-9 rounded-item border border-line bg-white/[0.015] px-3 font-sans text-sm text-text-1 tabular-nums placeholder:text-text-3 outline-none transition-colors duration-fast focus:border-[rgba(91,156,255,0.55)]";
const SELECT_INPUT_CLASS =
  "w-full h-9 appearance-none bg-none rounded-item border border-line bg-white/[0.015] pl-3 pr-8 font-sans text-sm text-text-1 tabular-nums outline-none transition-colors duration-fast focus:border-[rgba(91,156,255,0.55)]";

export function FFmpegAdvancedSection({
  ffmpegConfig,
  onSaveFFmpeg,
  reporter,
}: FFmpegAdvancedSectionProps) {
  const [form, setForm] = useState<AdvancedFormState>(() => toAdvancedFormState(ffmpegConfig));
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<AdvancedFormState | null>(null);
  const hasPendingDebounceRef = useRef(false);
  const onSaveFFmpegRef = useRef(onSaveFFmpeg);
  onSaveFFmpegRef.current = onSaveFFmpeg;
  const ffmpegConfigRef = useRef(ffmpegConfig);
  ffmpegConfigRef.current = ffmpegConfig;
  const reporterRef = useRef(reporter);
  reporterRef.current = reporter;
  const normalizedConfigKey = useMemo(() => serializeFFmpegConfig(ffmpegConfig), [ffmpegConfig]);
  const lastExternalConfigKeyRef = useRef<string>(normalizedConfigKey);
  const lastLocallySavedKeyRef = useRef<string | null>(null);
  const disableVideoLabelId = useId();
  const disableSubtitleLabelId = useId();

  useEffect(() => {
    const prevKey = lastExternalConfigKeyRef.current;
    lastExternalConfigKeyRef.current = normalizedConfigKey;

    const isSameExternalValue = normalizedConfigKey === prevKey;
    const isEchoOfLocalSave =
      lastLocallySavedKeyRef.current !== null &&
      lastLocallySavedKeyRef.current === normalizedConfigKey;

    if (isEchoOfLocalSave) {
      lastLocallySavedKeyRef.current = null;
      if (hasPendingDebounceRef.current) {
        return;
      }
    } else if (isSameExternalValue && hasPendingDebounceRef.current) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    hasPendingDebounceRef.current = false;
    pendingStateRef.current = null;
    setForm(toAdvancedFormState(ffmpegConfig));
  }, [ffmpegConfig, normalizedConfigKey]);

  function commitSave(stateToSave: AdvancedFormState): void {
    const nextConfig = formStateToFFmpegConfig(stateToSave, ffmpegConfigRef.current);
    lastLocallySavedKeyRef.current = serializeFFmpegConfig(nextConfig);
    void persistFFmpegConfig(onSaveFFmpegRef.current, nextConfig, reporterRef.current);
  }

  function flushPendingSave(): void {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!hasPendingDebounceRef.current && !pendingStateRef.current) {
      return;
    }
    hasPendingDebounceRef.current = false;
    const toSave = pendingStateRef.current;
    pendingStateRef.current = null;
    if (toSave) {
      commitSave(toSave);
    }
  }

  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;

  useEffect(() => {
    return () => {
      flushPendingSaveRef.current();
    };
  }, []);

  function saveImmediately(nextState: AdvancedFormState): void {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    hasPendingDebounceRef.current = false;
    pendingStateRef.current = null;
    setForm(nextState);
    commitSave(nextState);
  }

  function scheduleTextSave(nextState: AdvancedFormState): void {
    setForm(nextState);
    pendingStateRef.current = nextState;
    hasPendingDebounceRef.current = true;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      hasPendingDebounceRef.current = false;
      const toSave = pendingStateRef.current;
      pendingStateRef.current = null;
      if (toSave) {
        commitSave(toSave);
      }
    }, 500);
  }

  const presetOptions = useMemo(() => {
    const base = form.video_codec.includes("nvenc") ? NVENC_PRESETS : SOFTWARE_PRESETS;
    if (form.video_preset && !base.some((p) => p.id === form.video_preset)) {
      return [{ id: form.video_preset, label: form.video_preset, description: "" }, ...base];
    }
    return base;
  }, [form.video_codec, form.video_preset]);

  const ffmpegCommandArgs = useMemo(() => {
    const args: string[] = [];
    if (form.format) args.push(`-f ${form.format}`);
    if (form.video_codec) args.push(`-c:v ${form.video_codec}`);
    if (form.video_preset) args.push(`-preset ${form.video_preset}`);
    if (form.audio_codec) args.push(`-c:a ${form.audio_codec}`);
    if (form.video_bitrate) args.push(`-b:v ${form.video_bitrate}`);
    if (form.audio_bitrate) args.push(`-b:a ${form.audio_bitrate}`);
    if (form.framerate) args.push(`-r ${form.framerate}`);
    if (form.aspect_ratio) args.push(`-aspect ${form.aspect_ratio}`);
    if (form.audio_sample_rate) args.push(`-ar ${form.audio_sample_rate}`);
    if (form.audio_channels) args.push(`-ac ${form.audio_channels}`);
    if (form.disable_video) args.push("-vn");
    if (form.disable_audio) args.push("-an");
    if (form.disable_subtitle) args.push("-sn");
    if (form.video_filter) args.push(`-vf '${form.video_filter}'`);
    if (form.audio_filter) args.push(`-af '${form.audio_filter}'`);
    if (form.metadata) args.push(`-metadata '${form.metadata}'`);
    return args.join(" ");
  }, [form]);

  return (
    <div className="flex flex-col gap-6">
      {/* VÍDEO */}
      <section>
        <SettingsSectionLabel>VÍDEO</SettingsSectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ffmpeg-adv-video-codec" className={FIELD_LABEL_CLASS}>
              Codec de vídeo
            </label>
            <div className="relative">
              <select
                id="ffmpeg-adv-video-codec"
                value={form.video_codec}
                onChange={(event) => {
                  const nextCodec = event.target.value;
                  const usesNvenc = nextCodec.includes("nvenc");
                  const validPresets = usesNvenc ? NVENC_PRESETS : SOFTWARE_PRESETS;
                  const nextPreset = validPresets.some((p) => p.id === form.video_preset)
                    ? form.video_preset
                    : usesNvenc
                      ? "p5"
                      : "medium";
                  saveImmediately({
                    ...form,
                    video_codec: nextCodec,
                    video_preset: nextPreset,
                  });
                }}
                className={SELECT_INPUT_CLASS}
              >
                {VIDEO_CODECS.map((codec) => (
                  <option key={codec.id} value={codec.id} className="bg-[#12141a] text-text-1">
                    {codec.id}
                  </option>
                ))}
              </select>
              <CaretDown
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-video-preset" className={FIELD_LABEL_CLASS}>
              Preset
            </label>
            <div className="relative">
              <select
                id="ffmpeg-adv-video-preset"
                value={form.video_preset}
                onChange={(event) =>
                  saveImmediately({ ...form, video_preset: event.target.value })
                }
                className={SELECT_INPUT_CLASS}
              >
                {presetOptions.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-[#12141a] text-text-1">
                    {preset.id === "p5" ? "p5 (padrão)" : preset.label}
                  </option>
                ))}
              </select>
              <CaretDown
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-video-bitrate" className={FIELD_LABEL_CLASS}>
              Taxa de bits
            </label>
            <input
              id="ffmpeg-adv-video-bitrate"
              type="text"
              value={form.video_bitrate}
              placeholder="1000k, 5M…"
              onChange={(event) =>
                scheduleTextSave({ ...form, video_bitrate: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-framerate" className={FIELD_LABEL_CLASS}>
              Taxa de quadros
            </label>
            <input
              id="ffmpeg-adv-framerate"
              type="text"
              value={form.framerate}
              placeholder="Original"
              onChange={(event) => scheduleTextSave({ ...form, framerate: event.target.value })}
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-aspect-ratio" className={FIELD_LABEL_CLASS}>
              Proporção de tela
            </label>
            <input
              id="ffmpeg-adv-aspect-ratio"
              type="text"
              value={form.aspect_ratio}
              placeholder="9:16"
              onChange={(event) =>
                scheduleTextSave({ ...form, aspect_ratio: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-video-filter" className={FIELD_LABEL_CLASS}>
              Filtro de vídeo
            </label>
            <input
              id="ffmpeg-adv-video-filter"
              type="text"
              value={form.video_filter}
              placeholder="scale, crop…"
              onChange={(event) =>
                scheduleTextSave({ ...form, video_filter: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      {/* ÁUDIO */}
      <section>
        <SettingsSectionLabel>ÁUDIO</SettingsSectionLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ffmpeg-adv-audio-codec" className={FIELD_LABEL_CLASS}>
              Codec de áudio
            </label>
            <div className="relative">
              <select
                id="ffmpeg-adv-audio-codec"
                value={form.audio_codec}
                onChange={(event) =>
                  saveImmediately({ ...form, audio_codec: event.target.value })
                }
                className={SELECT_INPUT_CLASS}
              >
                {AUDIO_CODECS.map((codec) => (
                  <option key={codec.id} value={codec.id} className="bg-[#12141a] text-text-1">
                    {codec.id}
                  </option>
                ))}
              </select>
              <CaretDown
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-audio-bitrate" className={FIELD_LABEL_CLASS}>
              Taxa de bits
            </label>
            <input
              id="ffmpeg-adv-audio-bitrate"
              type="text"
              value={form.audio_bitrate}
              placeholder="128k, 192k…"
              onChange={(event) =>
                scheduleTextSave({ ...form, audio_bitrate: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-audio-sample-rate" className={FIELD_LABEL_CLASS}>
              Taxa de amostragem
            </label>
            <input
              id="ffmpeg-adv-audio-sample-rate"
              type="text"
              value={form.audio_sample_rate}
              placeholder="44100, 48000…"
              onChange={(event) =>
                scheduleTextSave({ ...form, audio_sample_rate: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-audio-channels" className={FIELD_LABEL_CLASS}>
              Canais
            </label>
            <input
              id="ffmpeg-adv-audio-channels"
              type="text"
              value={form.audio_channels}
              placeholder="1, 2, 6"
              onChange={(event) =>
                scheduleTextSave({ ...form, audio_channels: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ffmpeg-adv-audio-filter" className={FIELD_LABEL_CLASS}>
              Filtro de áudio
            </label>
            <input
              id="ffmpeg-adv-audio-filter"
              type="text"
              value={form.audio_filter}
              placeholder="volume, bass…"
              onChange={(event) =>
                scheduleTextSave({ ...form, audio_filter: event.target.value })
              }
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>
        </div>
      </section>

      {/* OUTROS */}
      <section>
        <SettingsSectionLabel>OUTROS</SettingsSectionLabel>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ffmpeg-adv-metadata" className={FIELD_LABEL_CLASS}>
              Metadados
            </label>
            <input
              id="ffmpeg-adv-metadata"
              type="text"
              value={form.metadata}
              placeholder="title=Meu Vídeo"
              onChange={(event) => scheduleTextSave({ ...form, metadata: event.target.value })}
              onBlur={flushPendingSave}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div className="flex h-9 items-center justify-between gap-3 rounded-item border border-line bg-white/[0.015] px-3">
            <span id={disableVideoLabelId} className="truncate text-sm text-text-1">
              Remover vídeo
            </span>
            <SettingsSwitch
              checked={form.disable_video}
              onChange={(next) => saveImmediately({ ...form, disable_video: next })}
              ariaLabelledBy={disableVideoLabelId}
            />
          </div>

          <div className="flex h-9 items-center justify-between gap-3 rounded-item border border-line bg-white/[0.015] px-3">
            <span id={disableSubtitleLabelId} className="truncate text-sm text-text-1">
              Remover legendas
            </span>
            <SettingsSwitch
              checked={form.disable_subtitle}
              onChange={(next) => saveImmediately({ ...form, disable_subtitle: next })}
              ariaLabelledBy={disableSubtitleLabelId}
            />
          </div>
        </div>
      </section>

      {/* PRÉVIA DO COMANDO */}
      <section>
        <SettingsSectionLabel>PRÉVIA DO COMANDO</SettingsSectionLabel>
        <div className="overflow-x-auto rounded-card border border-line bg-white/[0.02] px-4 py-3 font-sans text-xs tabular-nums leading-relaxed text-text-2">
          <span>ffmpeg -i </span>
          <span className="text-accent-soft">&quot;input.mp4&quot;</span>
          {ffmpegCommandArgs ? <span> {ffmpegCommandArgs} </span> : <span> </span>}
          <span className="text-accent-soft">&quot;output.mp4&quot;</span>
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 13 — Processar em lote (batch)                                         */
/* -------------------------------------------------------------------------- */

export interface BatchSectionVideoItem {
  job: {
    job_id: string;
    video_name?: string;
    status: string;
  };
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
}

export interface BatchSectionProps {
  videos: BatchSectionVideoItem[];
  selectedVideosForBatch: string[];
  batchPipelineOptions: BatchPipelineOptions;
  isBatchProcessing: boolean;
  activeBatchId?: string | null;
  onClose?: () => void;
  onVideoToggle: (videoId: string) => void;
  onOptionChange: (options: Partial<BatchPipelineOptions>) => void;
  onCancel: () => Promise<void> | void;
  onStart: () => Promise<void> | void;
}

function resolveBatchVideoStatus(status: string): { tone: StatusTone; label: string } {
  const normalized = status.toUpperCase();
  if (normalized === "DONE" || normalized === "COMPLETED") {
    return { tone: "success", label: "Concluído" };
  }
  if (
    normalized === "ANALYZING" ||
    normalized === "BUILDING_BLOCKS" ||
    normalized === "BUILDING_TOPICS"
  ) {
    return { tone: "warning", label: "Analisando" };
  }
  if (normalized === "TRANSCRIBING") {
    return { tone: "warning", label: "Transcrevendo" };
  }
  if (normalized === "RENDERING") {
    return { tone: "warning", label: "Renderizando" };
  }
  if (normalized === "DOWNLOADING") {
    return { tone: "warning", label: "Baixando" };
  }
  if (normalized === "ERROR" || normalized === "FAILED") {
    return { tone: "danger", label: "Erro" };
  }
  return { tone: "neutral", label: "Pendente" };
}

function resolveOverwriteWarning(
  video: BatchSectionVideoItem,
  isSelected: boolean,
  options: BatchPipelineOptions,
): string | null {
  if (!isSelected) return null;
  const overwriteTranscription = Boolean(video.hasTranscription && options.transcription);
  const overwriteAnalysis = Boolean(video.hasAnalysis && options.analysis);
  if (overwriteTranscription && overwriteAnalysis) {
    return "Transcrição e Análise existentes serão sobrescritas";
  }
  if (overwriteTranscription) {
    return "Transcrição existente será sobrescrita";
  }
  if (overwriteAnalysis) {
    return "Análise existente será sobrescrita";
  }
  return null;
}

export function BatchSection({
  videos,
  selectedVideosForBatch,
  batchPipelineOptions,
  isBatchProcessing,
  onVideoToggle,
  onOptionChange,
  onCancel,
  onStart,
}: BatchSectionProps) {
  const idPrefix = useId();
  const analysisEnabled = Boolean(batchPipelineOptions.analysis);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-md font-semibold text-text-1">Seus vídeos</h3>
        <p className="mt-0.5 text-sm text-text-3">
          Selecione um ou mais vídeos para processar em sequência.
        </p>

        <div className="mt-3 rounded-card border border-line bg-white/[0.015] divide-y divide-line max-h-[210px] overflow-y-auto">
          {videos.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-3">Nenhum vídeo disponível.</p>
          ) : (
            videos.map((video) => {
              const jobId = video.job.job_id;
              const checkboxId = `${idPrefix}-video-${jobId}`;
              const isSelected = selectedVideosForBatch.includes(jobId);
              const statusMeta = resolveBatchVideoStatus(video.job.status);
              const warningText = resolveOverwriteWarning(video, isSelected, batchPipelineOptions);

              return (
                <label
                  key={jobId}
                  htmlFor={checkboxId}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-[border-color,background-color,box-shadow] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isSelected ? "bg-[rgba(91,156,255,0.06)]" : "hover:bg-glass-hover"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={isSelected}
                      disabled={isBatchProcessing}
                      onChange={() => {
                        if (!isBatchProcessing) {
                          onVideoToggle(jobId);
                        }
                      }}
                      className="h-4 w-4 shrink-0 rounded border-line-strong bg-transparent accent-[var(--accent)]"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-1">
                        {video.job.video_name ||
                          (video.job as { source_file_name?: string }).source_file_name ||
                          video.job.job_id}
                      </p>
                      {warningText && (
                        <p className="mt-0.5 text-xs text-warning">{warningText}</p>
                      )}
                    </div>
                  </div>

                  <StatusDot
                    tone={statusMeta.tone}
                    label={statusMeta.label}
                    className="shrink-0 text-xs"
                  />
                </label>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h3 className="text-md font-semibold text-text-1">O que você deseja fazer?</h3>
        <p className="mt-0.5 text-sm text-text-3">
          Análise requer Transcrição. Renderizar e Revisar antes requerem Análise.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PickTile
            selected={true}
            ariaLabel="Transcrição — Obrigatória"
            className="transition-[border-color,background-color,box-shadow]"
          >
            <span className="text-base font-semibold text-text-1">Transcrição</span>
            <span className="mt-0.5 text-sm text-text-3">Obrigatória</span>
          </PickTile>

          <PickTile
            selected={analysisEnabled}
            disabled={isBatchProcessing}
            ariaLabel="Análise com IA — Identifica os ganchos"
            className="transition-[border-color,background-color,box-shadow]"
            onSelect={() => {
              if (isBatchProcessing) return;
              const nextAnalysis = !analysisEnabled;
              onOptionChange({
                analysis: nextAnalysis,
                render: nextAnalysis ? batchPipelineOptions.render : false,
                preApprove: nextAnalysis ? batchPipelineOptions.preApprove : false,
              });
            }}
          >
            <span className="text-base font-semibold text-text-1">Análise com IA</span>
            <span className="mt-0.5 text-sm text-text-3">Identifica os ganchos</span>
          </PickTile>

          <PickTile
            selected={analysisEnabled && Boolean(batchPipelineOptions.render)}
            disabled={isBatchProcessing || !analysisEnabled}
            ariaLabel="Renderizar — Gera os vídeos"
            className="transition-[border-color,background-color,box-shadow]"
            onSelect={() => {
              if (isBatchProcessing || !analysisEnabled) return;
              onOptionChange({ render: !batchPipelineOptions.render });
            }}
          >
            <span className="text-base font-semibold text-text-1">Renderizar</span>
            <span className="mt-0.5 text-sm text-text-3">Gera os vídeos</span>
          </PickTile>

          <PickTile
            selected={analysisEnabled && Boolean(batchPipelineOptions.preApprove)}
            disabled={isBatchProcessing || !analysisEnabled}
            ariaLabel="Revisar antes — Pausa para revisar"
            className="transition-[border-color,background-color,box-shadow]"
            onSelect={() => {
              if (isBatchProcessing || !analysisEnabled) return;
              onOptionChange({ preApprove: !batchPipelineOptions.preApprove });
            }}
          >
            <span className="text-base font-semibold text-text-1">Revisar antes</span>
            <span className="mt-0.5 text-sm text-text-3">Pausa para revisar</span>
          </PickTile>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2.5">
        {isBatchProcessing && (
          <GhostButton onClick={() => void onCancel()}>Cancelar processamento</GhostButton>
        )}
        <GhostButton
          leadingIcon={<Play size={13} />}
          disabled={isBatchProcessing || selectedVideosForBatch.length === 0}
          onClick={() => void onStart()}
        >
          Iniciar processamento
        </GhostButton>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 14 — Como usar (how-to-use)                                            */
/* -------------------------------------------------------------------------- */

interface HowToUseStep {
  step: string;
  title: string;
  description: string;
}

const HOW_TO_USE_STEPS: HowToUseStep[] = [
  {
    step: "01",
    title: "Dependências",
    description:
      "Abra Dependências e confirme que Python, Whisper, FFmpeg e Ollama estão instalados. Se faltar algo, use a instalação automática.",
  },
  {
    step: "02",
    title: "Modelo de IA",
    description:
      "Em IA e Modelos, escolha um modelo do Ollama para fazer a triagem dos melhores momentos.",
  },
  {
    step: "03",
    title: "Importação de mídia",
    description:
      "Cole uma URL do YouTube ou envie um arquivo MP4/MOV local em Novo vídeo.",
  },
  {
    step: "04",
    title: "Transcrição",
    description:
      "Transcreva o vídeo e aguarde terminar. Cada frase fica com um horário navegável.",
  },
  {
    step: "05",
    title: "Análise por IA",
    description:
      "A IA analisa os blocos de assunto e sugere os cortes, com ganchos e momentos de clímax.",
  },
  {
    step: "06",
    title: "Revisão e render",
    description:
      "Revise os cortes, ajuste início e fim, aprove os melhores e renderize em formato vertical.",
  },
];

export function HowToUseSection() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h3 className="text-md font-semibold text-text-1">Do vídeo longo aos cortes verticais</h3>
        <p className="mt-0.5 text-sm text-text-3">Siga o fluxo passo a passo.</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {HOW_TO_USE_STEPS.map((item) => (
          <article
            key={item.step}
            className="flex flex-col gap-2 rounded-card border border-line bg-glass p-4"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 items-center justify-center rounded-sm bg-white/[0.06] px-1.5 font-mono text-[11px] font-medium text-text-2">
                {item.step}
              </span>
              <h4 className="text-base font-semibold text-text-1">{item.title}</h4>
            </div>
            <p className="text-sm leading-relaxed text-text-3">{item.description}</p>
          </article>
        ))}
      </div>

      <div className="border border-[rgba(52,211,153,0.28)] bg-[rgba(52,211,153,0.08)] rounded-card px-4 py-3 text-xs text-success flex items-center gap-2">
        <Info size={16} className="shrink-0" />
        <span>
          <strong className="font-semibold">Dica:</strong> depois de validar um vídeo, use
          Processar em lote para tratar vários de uma vez.
        </span>
      </div>
    </div>
  );
}
