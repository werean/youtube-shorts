import type { JobStatus } from "../../types";

export interface CutPreset {
  id: "podcast" | "dinamico" | "curtos";
  label: string;
  description: string;
  targetDurationHint: string;
}

export const CUT_PRESETS: CutPreset[] = [
  {
    id: "podcast",
    label: "Podcast",
    description: "Cortes completos de raciocínio e histórias",
    targetDurationHint: "45s–90s",
  },
  {
    id: "dinamico",
    label: "Dinâmico",
    description: "Momentos de maior impacto e ritmo",
    targetDurationHint: "25s–50s",
  },
  {
    id: "curtos",
    label: "Cortes curtos",
    description: "Pílulas diretas e ganchos rápidos",
    targetDurationHint: "15s–30s",
  },
];

export function getHumanJobStatusLabel(status?: JobStatus | string | null): string | null {
  switch (status) {
    case "CREATED":
      return "Preparando…";
    case "DOWNLOADING":
      return "Baixando vídeo…";
    case "TRANSCRIBING":
      return "Transcrevendo…";
    case "BUILDING_BLOCKS":
    case "BUILDING_TOPICS":
      return "Organizando fala…";
    case "ANALYZING":
      return "Encontrando cortes…";
    case "WAITING_APPROVAL":
      return "Aguardando aprovação";
    case "RENDERING":
      return "Gerando vídeos…";
    case "ERROR":
      return "Não foi possível concluir";
    default:
      return null;
  }
}

export function isJobProcessingStatus(status?: JobStatus | string | null): boolean {
  return (
    status === "DOWNLOADING" ||
    status === "TRANSCRIBING" ||
    status === "BUILDING_BLOCKS" ||
    status === "BUILDING_TOPICS" ||
    status === "ANALYZING" ||
    status === "RENDERING"
  );
}

export function getHumanErrorMessage(rawError?: string | null): string {
  if (!rawError) return "Algo deu errado ao processar este vídeo.";
  const lower = rawError.toLowerCase();
  if (lower.includes("out of memory") || lower.includes("vram") || lower.includes("cuda")) {
    return "Faltou memória de vídeo durante o processamento. Tente ajustar nas configurações ou tentar de novo.";
  }
  if (lower.includes("ollama") || lower.includes("lm studio") || lower.includes("econnrefused")) {
    return "O serviço de IA local não respondeu. Verifique se ele está aberto e tente de novo.";
  }
  if (lower.includes("render") && lower.includes("andamento")) {
    return "Já existe outro vídeo sendo gerado agora. Aguarde terminar ou cancele antes.";
  }
  if (lower.includes("transcri") && lower.includes("andamento")) {
    return "Já existe outra transcrição em andamento. Cancele antes de iniciar outra.";
  }
  if (lower.includes("yt_dlp") || lower.includes("download")) {
    return "Não foi possível baixar o vídeo a partir desse link.";
  }
  return rawError;
}

export function formatShortTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
