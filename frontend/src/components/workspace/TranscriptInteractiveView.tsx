import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { GlassBadge, GlassButton } from "../ui/glass";
import type { Segment, Cut } from "../../types";

export interface TranscriptInteractiveViewProps {
  segments?: Segment[];
  currentTime?: number;
  activeCut?: Cut | null;
  onSeek: (seconds: number) => void;
  onCreateCutFromSelection?: (start: number, end: number, text?: string) => void;
  isLoading?: boolean;
  onRequestTranscription?: () => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  className?: string;
}

export function TranscriptInteractiveView({
  segments = [],
  currentTime = 0,
  activeCut,
  onSeek,
  onCreateCutFromSelection,
  isLoading = false,
  onRequestTranscription,
  isExpanded = true,
  onToggleExpanded,
  className,
}: TranscriptInteractiveViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // Filtro de busca na transcricao
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const query = searchQuery.toLowerCase();
    return segments.filter((seg) => seg.text.toLowerCase().includes(query));
  }, [segments, searchQuery]);

  const activeSegment = useMemo(() => {
    if (selectedSegmentId) {
      return segments.find((s) => s.segment_id === selectedSegmentId) || null;
    }
    return null;
  }, [segments, selectedSegmentId]);

  const handleSegmentClick = (segment: Segment) => {
    setSelectedSegmentId(segment.segment_id);
    onSeek(segment.start);
  };

  const handleCreateCut = () => {
    if (!activeSegment || !onCreateCutFromSelection) return;
    onCreateCutFromSelection(activeSegment.start, activeSegment.end, activeSegment.text);
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c0e]/80 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300",
        isExpanded ? "" : "h-auto",
        className,
      )}
    >
      {/* Cabecalho da Transcricao */}
      <div className="flex flex-col gap-2.5 p-3.5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
              Transcricao Interativa
            </span>
            {segments.length > 0 && (
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-text-3">
                {segments.length} blocos
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Botao de Acao: Criar Corte do Trecho */}
            {isExpanded && onCreateCutFromSelection && (
              <GlassButton
                variant="glass"
                size="sm"
                onClick={handleCreateCut}
                disabled={!activeSegment}
                title={
                  activeSegment
                    ? `Criar corte do trecho selecionado (${formatTimestamp(activeSegment.start)} - ${formatTimestamp(activeSegment.end)})`
                    : "Selecione uma frase abaixo para criar o corte"
                }
                icon={
                  <svg
                    className="h-3 w-3 mr-1 text-text-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" />
                    <line x1="14.47" y1="14.48" x2="20" y2="20" />
                    <line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                }
              >
                + Criar Corte do Trecho
              </GlassButton>
            )}

            {/* Toggle de Recolher / Expandir com setinhas */}
            {onToggleExpanded && (
              <button
                type="button"
                onClick={onToggleExpanded}
                title={isExpanded ? "Ocultar / Recolher Transcrição" : "Exibir Transcrição"}
                className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white px-2 py-0.5 rounded border border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.06] transition-all"
              >
                <span>{isExpanded ? "Ocultar" : "Exibir"}</span>
                <svg
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200",
                    isExpanded ? "rotate-180" : "rotate-0",
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Barra de Busca de Palavras-chave */}
        {isExpanded && segments.length > 0 && (
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar fala ou trecho..."
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-1.5 pl-8 pr-3 text-body-sm text-text-1 placeholder:text-text-3 outline-none transition-colors focus:border-white/[0.2] focus:bg-white/[0.06]"
            />
          </div>
        )}
      </div>

      {/* Area de Conteudo / Transcricao continua sincronizada */}
      {isExpanded && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-white/10">
          {isLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-text-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="text-body-sm">Processando transcricao do audio com Whisper...</p>
            </div>
          ) : segments.length === 0 ? (
            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2.5 p-4 text-center text-text-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02]">
                <svg
                  className="h-5 w-5 stroke-[1.5]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <p className="text-sm font-medium text-white">Nenhuma transcrição disponível</p>
                <p className="text-xs text-text-3 leading-relaxed">
                  Gere a transcrição deste vídeo com o Whisper para sincronizar o texto, navegar pelas falas e extrair cortes virais.
                </p>
              </div>
              {onRequestTranscription && (
                <GlassButton
                  variant="glass"
                  size="md"
                  onClick={onRequestTranscription}
                  className="mt-2 px-5 font-semibold text-white bg-white/[0.08] hover:bg-white/[0.15] border-white/20 shadow-[0_4px_20px_rgba(0,0,0,0.4),inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                  icon={
                    <svg
                      className="h-4 w-4 mr-1 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  }
                >
                  Transcrever Vídeo
                </GlassButton>
              )}
            </div>
          ) : (
            filteredSegments.map((segment) => {
              // Verifica se o segmento esta dentro do corte selecionado atualmente
              const isInsideActiveCut =
                activeCut &&
                segment.end >= activeCut.start &&
                segment.start <= activeCut.end;

              // Verifica se o tempo atual do player esta dentro desta frase
              const isCurrentlyPlaying =
                currentTime >= segment.start && currentTime <= segment.end;

              const isSelected = segment.segment_id === selectedSegmentId;

              return (
                <div
                  key={segment.segment_id}
                  ref={isCurrentlyPlaying ? activeSegmentRef : null}
                  onClick={() => handleSegmentClick(segment)}
                  className={cn(
                    "group relative flex items-start gap-3 rounded-xl border p-2.5 transition-all duration-200 cursor-pointer select-text",
                    // Placa de vidro luminoso quando for parte do corte ativo
                    isInsideActiveCut
                      ? "border-amber-400/40 bg-amber-400/[0.07] shadow-[0_0_25px_rgba(251,191,36,0.12),inset_0_1px_0_0_rgba(251,191,36,0.2)] text-white"
                      : isSelected
                        ? "border-white/30 bg-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] text-white"
                        : "border-transparent bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04] text-text-2 hover:text-text-1",
                    isCurrentlyPlaying &&
                      !isInsideActiveCut &&
                      "border-l-2 border-l-white bg-white/[0.05] text-white",
                  )}
                >
                  {/* Timestamp Monospace com visual de badge sutil */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeek(segment.start);
                    }}
                    title="Pular para este segundo"
                    className={cn(
                      "flex-shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-all",
                      isInsideActiveCut
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                        : "border-white/[0.08] bg-white/[0.04] text-text-3 group-hover:border-white/[0.18] group-hover:text-text-2",
                    )}
                  >
                    {formatTimestamp(segment.start)}
                  </button>

                  {/* Texto da transcricao */}
                  <p className="flex-1 text-body-sm leading-relaxed">{segment.text}</p>

                  {/* Tag de Corte IA quando pertencer ao corte ativo */}
                  {isInsideActiveCut && (
                    <span className="flex-shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-400/30">
                      Corte Ativo
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
