/**
 * Tipos e configurações completas para FFmpeg
 * Baseado em: ffmpeg --help
 */

export interface FFmpegConfig {
  // Basic options
  format?: string; // -f (mp4, mkv, avi, mov, webm, etc)
  video_codec?: string; // -c:v (h264, h265, vp9, av1, etc)
  audio_codec?: string; // -c:a (aac, mp3, opus, flac, etc)

  // Advanced options
  video_bitrate?: string; // -b:v (1000k, 5M, etc)
  video_preset?: string; // -preset (p1-p7 for NVIDIA NVENC, faster/slow for software)
  audio_bitrate?: string; // -b:a (128k, 192k, etc)
  framerate?: string; // -r (24, 30, 60, 29.97, etc)
  aspect_ratio?: string; // -aspect (16:9, 4:3, 1.77, 1.33, etc)
  audio_sample_rate?: string; // -ar (44100, 48000, 96000, etc)
  audio_channels?: string; // -ac (1, 2, 6, etc)
  disable_video: boolean; // -vn
  disable_audio: boolean; // -an
  disable_subtitle: boolean; // -sn
  video_filter?: string; // -vf (scale, crop, rotate, etc)
  audio_filter?: string; // -af (volume, bass, etc)
  metadata?: string; // -metadata (title, author, etc)
}

export const VIDEO_CODECS = [
  {
    id: "h264_nvenc",
    label: "H.264 (NVIDIA NVENC)",
    description: "Aceleração GPU NVIDIA - PADRÃO DO SISTEMA",
  },
  {
    id: "hevc_nvenc",
    label: "H.265 (NVIDIA NVENC)",
    description: "Aceleração GPU NVIDIA, melhor compressão",
  },
  { id: "h264", label: "H.264 (Software)", description: "CPU, compatível mas lento" },
  { id: "h265", label: "H.265 (Software)", description: "CPU, melhor compressão mas muito lento" },
  { id: "vp9", label: "VP9", description: "Google, YouTube, WebM" },
  { id: "av1", label: "AV1", description: "Compressão máxima, mais lento" },
];

export const AUDIO_CODECS = [
  { id: "aac", label: "AAC (Advanced Audio Codec)", description: "Padrão, compatível" },
  { id: "mp3", label: "MP3 (MPEG-1 Layer III)", description: "Compatível, antigo" },
  { id: "opus", label: "Opus", description: "Melhor qualidade, moderno" },
  { id: "flac", label: "FLAC (Free Lossless)", description: "Sem perda de qualidade" },
  { id: "pcm", label: "PCM (WAV)", description: "Sem compressão, muito pesado" },
  { id: "libvorbis", label: "Vorbis", description: "Qualidade boa, open source" },
];

export const NVENC_PRESETS = [
  { id: "p1", label: "p1 (Mais rápido)", description: "Velocidade máxima, menor qualidade" },
  { id: "p2", label: "p2", description: "Rápido" },
  { id: "p3", label: "p3", description: "Rápido-Médio" },
  { id: "p4", label: "p4", description: "Médio" },
  {
    id: "p5",
    label: "p5 (PADRÃO)",
    description: "Padrão do sistema - Qualidade boa / Velocidade equilibrada",
  },
  { id: "p6", label: "p6", description: "Médio-Lento" },
  { id: "p7", label: "p7 (Melhor qualidade)", description: "Qualidade máxima, mais lento" },
];

export const SOFTWARE_PRESETS = [
  { id: "faster", label: "Faster", description: "Mais rápido" },
  { id: "fast", label: "Fast", description: "Rápido" },
  { id: "medium", label: "Medium", description: "Médio" },
  { id: "slow", label: "Slow", description: "Lento" },
  { id: "slower", label: "Slower", description: "Muito lento" },
];

export const CONTAINER_FORMATS = [
  { id: "mp4", label: "MP4", description: "Padrão universal" },
  { id: "mkv", label: "MKV (Matroska)", description: "Flexível, suporta tudo" },
  { id: "mov", label: "MOV (QuickTime)", description: "Apple, Final Cut Pro" },
  { id: "avi", label: "AVI", description: "Antigo, compatível" },
  { id: "webm", label: "WebM", description: "Web, VP9/VP8+Opus" },
  { id: "flv", label: "FLV", description: "Adobe Flash, antigo" },
  { id: "m3u8", label: "M3U8 (HLS)", description: "Streaming de vídeo" },
];

export const FFMPEG_CONFIG_FIELDS = {
  format: {
    tooltip:
      "Formato de saída (mp4, mkv, avi, mov, webm, etc). Deixe vazio para detectar pela extensão do arquivo.",
    description: "Formato/contêiner do arquivo de saída",
  },
  video_codec: {
    tooltip:
      "h264 = compatível e rápido. h265 = melhor compressão. vp9/av1 = web moderno. Deixe vazio para não alternar.",
    description: "Tipo de codificação de vídeo",
  },
  video_preset: {
    tooltip:
      "NVIDIA NVENC: p1-p7 (p1=mais rápido/menor qualidade, p7=mais lento/melhor qualidade). Padrão do sistema: p5. Software: faster/fast/medium/slow/slower.",
    description: "Velocidade de codificação vs qualidade",
  },
  audio_codec: {
    tooltip:
      "aac = compatível. mp3 = antigo. opus = melhor qualidade. flac = sem perda. Deixe vazio para não alterar.",
    description: "Tipo de codificação de áudio",
  },
  video_bitrate: {
    tooltip:
      "Taxa de compressão do vídeo. Exemplos: 1000k (1 Mbps), 5M (5 Mbps). Maior = melhor qualidade mas arquivo maior.",
    description: "Qualidade/tamanho do vídeo",
  },
  audio_bitrate: {
    tooltip:
      "Taxa de compressão do áudio. Exemplos: 128k (música), 192k (qualidade), 256k (máxima). Deixe vazio para padrão.",
    description: "Qualidade do áudio",
  },
  framerate: {
    tooltip:
      "Quadros por segundo. Exemplos: 24 (cinema), 30 (TV), 60 (gaming). Deixe vazio para manter original.",
    description: "Velocidade dos quadros",
  },
  aspect_ratio: {
    tooltip:
      "Proporção de tela. Exemplos: 16:9 (widescreen), 4:3 (antigo), 1:1 (quadrado). Deixe vazio para manter original.",
    description: "Proporção da tela",
  },
  audio_sample_rate: {
    tooltip:
      "Frequência de amostragem do áudio em Hz. 44100 = CD, 48000 = vídeo profissional, 96000 = Hi-Fi. Deixe vazio para padrão.",
    description: "Frequência do áudio",
  },
  audio_channels: {
    tooltip:
      "Número de canais. 1 = mono, 2 = estéreo, 6 = surround 5.1. Deixe vazio para manter original.",
    description: "Canais de áudio",
  },
  disable_video: {
    tooltip: "Se ligado, extrai apenas o áudio (remove vídeo).",
    description: "Remover vídeo",
  },
  disable_audio: {
    tooltip: "Se ligado, mantém apenas o vídeo (remove áudio).",
    description: "Remover áudio",
  },
  disable_subtitle: {
    tooltip: "Se ligado, remove legendas do vídeo.",
    description: "Remover legendas",
  },
  video_filter: {
    tooltip:
      "Filtros avançados de vídeo. Exemplos: 'scale=1920:1080' (redimensionar), 'rotate=90' (girar), 'crop=1280:720'. Deixe vazio para nenhum.",
    description: "Efeitos/filtros de vídeo",
  },
  audio_filter: {
    tooltip:
      "Filtros de áudio. Exemplos: 'volume=0.5' (diminuir volume), 'bass=7' (aumentar graves). Deixe vazio para nenhum.",
    description: "Efeitos/filtros de áudio",
  },
  metadata: {
    tooltip:
      "Adicionar informações. Exemplos: 'title=Meu Vídeo' ou 'artist=Seu Nome'. Use aspas se tiver espaços.",
    description: "Informações do arquivo",
  },
};
