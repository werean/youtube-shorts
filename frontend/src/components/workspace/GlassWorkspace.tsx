import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Cut } from "../../types";
import type { VideoItem } from "../../utils/videoHelpers";
import { parseTimestampInput } from "../../utils/formatters";
import { TaskLogPanel } from "../app/TaskLogPanel";
import { StylePresetPanel } from "./StylePresetPanel";
import type { ExtraKind, ShortStylePreset, StyleLibrary } from "../../../../shared/stylePresets";

export type StageSelection = {
  transcribe: boolean;
  blocks: boolean;
  analyze: boolean;
  render: boolean;
};

type UploadMode = "url" | "file";

interface ActionState {
  busy: boolean;
  error?: string;
}

interface GlassWorkspaceProps {
  uploadMode: UploadMode;
  youtubeUrl: string;
  selectedFiles: File[];
  isDraggingFile: boolean;
  onUploadMode: (mode: UploadMode) => void;
  onYoutubeUrl: (value: string) => void;
  onSelectedFiles: (files: File[]) => void;
  onDraggingFile: (value: boolean) => void;
  videos: VideoItem[];
  archivedVideos: VideoItem[];
  activeVideoId: string | null;
  activeVideo?: VideoItem;
  videoView: "active" | "archived";
  onSelectVideo: (videoId: string | null) => void;
  onSetView: (view: "active" | "archived") => void;
  onOpenFolder: (videoId: string) => void;
  onRename: (videoId: string, name: string) => void;
  onArchive: (videoId: string) => void;
  onDelete: (videoId: string) => void;
  onStart: (stages: StageSelection) => void;
  busy: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  apiBaseUrl: string;
  suggestedCuts: Cut[];
  selectedSuggestedCutId: string | null;
  onSelectCut: (cut: Cut) => void;
  onAdjustCut: (cut: Cut) => void;
  onCommitCut: (cutId: string, changes: Partial<Pick<Cut, "start" | "end" | "title">>) => void;
  onRender: () => void;
  isRendering: boolean;
  renderOutputs: string[];
  renderTitlesByFileName: Record<string, string>;
  onOpenRenderFolder: (fileName: string) => void;
  onDeleteRender: (fileName: string) => void;
  onOpenSettings: (which: "app" | "deps" | "llm" | "whisper" | "ffmpeg" | "help") => void;
  onShowTranscription: () => void;
  onAddManualCut: () => void;
  onBatch: () => void;
  showContinueBatch: boolean;
  onContinueBatch: () => void;
  batchLogs: string[];
  taskLogsContainerRef: RefObject<HTMLDivElement>;
  activeTaskLogType: "transcription" | "render" | null;
  activeTaskLogs: string[];
  expandTaskLogs: boolean;
  onShowMoreTaskLogs: () => void;
  onCancelTranscription: () => void;
  onCancelRendering: () => void;
  isTranscribing: boolean;
  styleLibrary: StyleLibrary;
  activePreset?: ShortStylePreset;
  onSelectPreset: (id: string) => void;
  onUpdatePreset: (recipe: (preset: ShortStylePreset) => ShortStylePreset) => void;
  onCreatePreset: () => void;
  onDuplicatePreset: () => void;
  onRemovePreset: () => void;
  onResetPreset: () => void;
  onAddExtra: (label: string, kind: ExtraKind) => void;
  onRemoveExtra: (id: string) => void;
}

const STAGE_ROWS: Array<{ key: keyof StageSelection | "all"; label: string; icon: string }> = [
  { key: "transcribe", label: "Transcrever", icon: "description" },
  { key: "blocks", label: "Blocos", icon: "grid_view" },
  { key: "analyze", label: "Analisar", icon: "bar_chart" },
  { key: "render", label: "Renderizar", icon: "movie" },
  { key: "all", label: "Todas", icon: "done_all" },
];

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatAdded(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const day = 86400000;
  if (diff < day) return "Hoje";
  if (diff < 2 * day) return "Ontem";
  const days = Math.floor(diff / day);
  if (days < 30) return `${days} dias atrás`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(then);
}

export function GlassWorkspace(props: GlassWorkspaceProps) {
  const [runAll, setRunAll] = useState(true);
  const [stages, setStages] = useState<StageSelection>({
    transcribe: false,
    blocks: false,
    analyze: false,
    render: false,
  });
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuVideoId, setMenuVideoId] = useState<string | null>(null);
  const [styleOpen, setStyleOpen] = useState(
    () => new URLSearchParams(window.location.search).has("estilo"),
  );
  const [rateOpen, setRateOpen] = useState(false);
  const [playback, setPlayback] = useState({ time: 0, duration: 0, playing: false, muted: false });
  const [titleEditId, setTitleEditId] = useState<string | null>(null);

  useEffect(() => {
    const video = props.videoRef.current;
    if (!video) return;
    const sync = () =>
      setPlayback({
        time: video.currentTime || 0,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        playing: !video.paused,
        muted: video.muted,
      });
    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
    };
  }, [props.activeVideo?.job.job_id, props.videoRef]);

  const displayed = props.videoView === "active" ? props.videos : props.archivedVideos;
  const ordered = displayed.slice().reverse();
  const visibleVideos = showAllVideos ? ordered : ordered.slice(0, 4);

  function stageOn(key: (typeof STAGE_ROWS)[number]["key"]) {
    if (key === "all") return runAll;
    return runAll ? false : stages[key];
  }

  function toggleStage(key: (typeof STAGE_ROWS)[number]["key"]) {
    if (key === "all") {
      setRunAll((current) => !current);
      if (!runAll) {
        setStages({ transcribe: false, blocks: false, analyze: false, render: false });
      }
      return;
    }
    setRunAll(false);
    setStages((current) => ({ ...current, [key]: !current[key] }));
  }

  function effectiveStages(): StageSelection {
    if (runAll) {
      return { transcribe: true, blocks: true, analyze: true, render: true };
    }
    return stages;
  }

  const settingsAnchor = (
    <div style={{ position: "relative" }}>
      <button type="button" className="corte-settings" onClick={() => setSettingsOpen((open) => !open)}>
        <span className="material-icons corte-icon">settings</span>
        Configurações
      </button>
      {settingsOpen && (
        <div className="corte-menu corte-glass">
          {(
            [
              ["app", "Aplicação"],
              ["deps", "Dependências"],
              ["llm", "LLM"],
              ["whisper", "Whisper"],
              ["ffmpeg", "FFmpeg"],
              ["help", "Como utilizar"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                props.onOpenSettings(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="corte-app">
      <header className="corte-top">
        <div className="corte-brand">
          <span className="material-icons">close</span>
          Corte
        </div>
        {settingsAnchor}
      </header>

      <div className="corte-columns">
        <section className="corte-col corte-glass">
          <h2 className="corte-title">Adicionar vídeo</h2>
          <div className="corte-seg">
            <button
              type="button"
              className={props.uploadMode === "url" ? "active" : ""}
              onClick={() => props.onUploadMode("url")}
            >
              <span className="material-icons" style={{ fontSize: 16 }}>
                link
              </span>
              Link do YouTube
            </button>
            <button
              type="button"
              className={props.uploadMode === "file" ? "active" : ""}
              onClick={() => props.onUploadMode("file")}
            >
              <span className="material-icons" style={{ fontSize: 16 }}>
                folder
              </span>
              Arquivo do PC
            </button>
          </div>

          {props.uploadMode === "url" ? (
            <label className="corte-stack">
              <input
                className="corte-field"
                value={props.youtubeUrl}
                placeholder="Cole o link do YouTube aqui"
                onChange={(event) => props.onYoutubeUrl(event.target.value)}
              />
              <span className="corte-hint">Exemplo: https://www.youtube.com/watch?v=xxxxxxxxxxx</span>
            </label>
          ) : (
            <div
              className={`corte-drop${props.isDraggingFile ? " dragging" : ""}`}
              onClick={() => document.getElementById("video-file-input")?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                props.onDraggingFile(true);
              }}
              onDragLeave={() => props.onDraggingFile(false)}
              onDrop={(event) => {
                event.preventDefault();
                props.onDraggingFile(false);
                const files = Array.from(event.dataTransfer.files).filter((file) =>
                  file.type.startsWith("video/"),
                );
                if (files.length === 0) return;
                props.onSelectedFiles([...props.selectedFiles, ...files]);
              }}
            >
              <strong>
                {props.selectedFiles.length > 0
                  ? `${props.selectedFiles.length} arquivo(s) selecionado(s)`
                  : "Arraste um vídeo ou clique para escolher"}
              </strong>
              <span>{props.selectedFiles.map((file) => file.name).join(", ")}</span>
            </div>
          )}
          <input
            id="video-file-input"
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length === 0) return;
              props.onSelectedFiles([...props.selectedFiles, ...files]);
            }}
          />

          <div className="corte-stack">
            <p className="corte-kicker">Etapas do processamento</p>
            <div className="corte-stages">
              {STAGE_ROWS.map((row) => {
                const on = stageOn(row.key);
                return (
                  <div key={row.label} className="corte-stage">
                    <span>
                      <span className="material-icons" style={{ fontSize: 18 }}>
                        {row.icon}
                      </span>
                      {row.label}
                    </span>
                    <button
                      type="button"
                      className={`corte-switch${on ? " on" : ""}`}
                      aria-pressed={on}
                      aria-label={row.label}
                      onClick={() => toggleStage(row.key)}
                    >
                      <i />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            id="corte-start"
            type="button"
            className="corte-start"
            disabled={props.busy}
            onClick={() => props.onStart(effectiveStages())}
          >
            <span className="material-icons">play_arrow</span>
            Iniciar
          </button>

          <div className="corte-library">
            <p className="corte-kicker">Vídeos adicionados</p>
            {showAllVideos && (
              <div className="corte-seg">
                <button
                  type="button"
                  className={props.videoView === "active" ? "active" : ""}
                  onClick={() => props.onSetView("active")}
                >
                  Ativos
                </button>
                <button
                  type="button"
                  className={props.videoView === "archived" ? "active" : ""}
                  onClick={() => props.onSetView("archived")}
                >
                  Arquivados
                </button>
              </div>
            )}
            {visibleVideos.length === 0 ? (
              <p className="corte-hint">
                {props.videoView === "archived"
                  ? "Nenhum vídeo arquivado."
                  : "Nenhum vídeo ainda. Adicione um link ou arquivo."}
              </p>
            ) : (
              visibleVideos.map((video) => {
                const id = video.job.job_id;
                const duration = video.job.video_duration_seconds;
                const meta = [duration ? formatClock(duration) : "", formatAdded(video.job.created_at)]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={id} className="corte-row-wrap">
                    <button
                      type="button"
                      className={`corte-video${props.activeVideoId === id ? " selected" : ""}`}
                      onClick={() => props.onSelectVideo(props.activeVideoId === id ? null : id)}
                    >
                      <span className="corte-thumb">
                        {video.videoPath ? (
                          <video
                            muted
                            playsInline
                            preload="metadata"
                            src={`${props.apiBaseUrl}${video.videoPath}#t=0.5`}
                          />
                        ) : (
                          <span />
                        )}
                        {duration ? <b>{formatClock(duration)}</b> : null}
                      </span>
                      <span className="corte-video-copy">
                        <strong>{video.job.video_name || video.job.source_file_name || "Sem nome"}</strong>
                        <small>{meta || video.job.status}</small>
                      </span>
                      <span
                        className="corte-more"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuVideoId((current) => (current === id ? null : id));
                        }}
                      >
                        <span className="material-icons">more_horiz</span>
                      </span>
                    </button>
                    {menuVideoId === id && (
                      <div className="corte-pop corte-glass">
                        <button type="button" onClick={() => props.onOpenFolder(id)}>
                          Abrir pasta
                        </button>
                        {props.videoView === "active" && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setMenuVideoId(null);
                                props.onRename(id, video.job.video_name || "");
                              }}
                            >
                              Renomear
                            </button>
                            <button type="button" onClick={() => props.onArchive(id)}>
                              Arquivar
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => props.onDelete(id)}>
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <button type="button" className="corte-link" onClick={() => setShowAllVideos((open) => !open)}>
              {showAllVideos ? "Mostrar menos" : "Ver todos os vídeos"}
              <span className="material-icons">chevron_right</span>
            </button>
          </div>
        </section>

        <section className="corte-col corte-glass">
          <div className="corte-head">
            <h2 className="corte-title">Vídeo selecionado</h2>
            <button
              id="corte-open-style"
              type="button"
              className="corte-style-launch"
              onClick={() => setStyleOpen(true)}
            >
              Estilo · {props.activePreset?.name || "Clássico"}
            </button>
          </div>

          <div className="corte-player-wrap">
            {props.activeVideo?.videoPath ? (
              <video
                key={props.activeVideo.job.job_id}
                ref={props.videoRef}
                src={`${props.apiBaseUrl}${props.activeVideo.videoPath}`}
                onClick={() => {
                  const video = props.videoRef.current;
                  if (!video) return;
                  if (video.paused) void video.play();
                  else video.pause();
                }}
              />
            ) : (
              <div className="corte-player-empty">
                {props.activeVideo ? "Aguardando o arquivo do vídeo." : "Nenhum vídeo selecionado"}
              </div>
            )}
            <div className="corte-controls">
              <button
                type="button"
                aria-label={playback.playing ? "Pausar" : "Reproduzir"}
                onClick={() => {
                  const video = props.videoRef.current;
                  if (!video) return;
                  if (video.paused) void video.play();
                  else video.pause();
                }}
              >
                <span className="material-icons">{playback.playing ? "pause" : "play_arrow"}</span>
              </button>
              <span className="corte-time">
                {formatClock(playback.time)} / {formatClock(playback.duration)}
              </span>
              <button
                type="button"
                aria-label={playback.muted ? "Ativar som" : "Silenciar"}
                onClick={() => {
                  const video = props.videoRef.current;
                  if (!video) return;
                  video.muted = !video.muted;
                  setPlayback((current) => ({ ...current, muted: video.muted }));
                }}
              >
                <span className="material-icons">{playback.muted ? "volume_off" : "volume_up"}</span>
              </button>
              <input
                className="corte-range"
                type="range"
                min={0}
                max={playback.duration || 0}
                step={0.1}
                value={Math.min(playback.time, playback.duration || 0)}
                onChange={(event) => {
                  const video = props.videoRef.current;
                  if (!video) return;
                  video.currentTime = Number(event.target.value);
                }}
              />
              <div style={{ position: "relative" }}>
                <button type="button" aria-label="Velocidade" onClick={() => setRateOpen((open) => !open)}>
                  <span className="material-icons">settings</span>
                </button>
                {rateOpen && (
                  <div className="corte-pop corte-glass" style={{ bottom: 36, top: "auto" }}>
                    {[1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => {
                          if (props.videoRef.current) props.videoRef.current.playbackRate = rate;
                          setRateOpen(false);
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Tela cheia"
                onClick={() => {
                  const shell = props.videoRef.current?.parentElement;
                  if (!shell) return;
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void shell.requestFullscreen();
                }}
              >
                <span className="material-icons">fullscreen</span>
              </button>
            </div>
          </div>

          {props.batchLogs.length > 0 && (
            <div className="corte-logs">{props.batchLogs.join("\n")}</div>
          )}
          {props.activeTaskLogType && (
            <TaskLogPanel
              taskLogsContainerRef={props.taskLogsContainerRef}
              activeTaskLogType={props.activeTaskLogType}
              activeTaskLogs={props.activeTaskLogs}
              expandTaskLogs={props.expandTaskLogs}
              showTranscriptionCancel={props.activeTaskLogType === "transcription" && props.isTranscribing}
              showRenderCancel={props.activeTaskLogType === "render" && props.isRendering}
              onShowMoreTaskLogs={props.onShowMoreTaskLogs}
              onCancelTranscription={props.onCancelTranscription}
              onCancelRendering={props.onCancelRendering}
            />
          )}

          <div className="corte-head">
            <p className="corte-kicker">
              Cortes gerados <span className="corte-count">{props.suggestedCuts.length}</span>
            </p>
            <div className="corte-actions">
              <button type="button" className="corte-ghost" onClick={props.onShowTranscription}>
                Transcrição
              </button>
              <button type="button" className="corte-ghost" onClick={props.onAddManualCut}>
                Corte manual
              </button>
              <button type="button" className="corte-ghost" onClick={props.onBatch}>
                Lote
              </button>
            </div>
          </div>

          {props.showContinueBatch && (
            <button type="button" className="corte-ghost" onClick={props.onContinueBatch}>
              Continuar pipeline
            </button>
          )}

          <div className="corte-cuts">
            {props.suggestedCuts.length === 0 ? (
              <p className="corte-hint">Nenhum corte gerado ainda.</p>
            ) : (
              props.suggestedCuts.map((cut) => {
                const selected = props.selectedSuggestedCutId === cut.cut_id;
                return (
                  <div key={cut.cut_id} className="corte-cut">
                    <input
                      className="corte-check"
                      type="checkbox"
                      checked={selected}
                      aria-label="Selecionar corte"
                      onChange={() => props.onSelectCut(cut)}
                    />
                    <span className="corte-cut-times">
                      <input
                        className="corte-field corte-timebox"
                        defaultValue={formatClock(cut.start)}
                        key={`${cut.cut_id}-start-${cut.start}`}
                        aria-label="Início"
                        onBlur={(event) => {
                          const value = parseTimestampInput(event.target.value);
                          if (value === null || value === cut.start) return;
                          props.onCommitCut(cut.cut_id, { start: value });
                        }}
                      />
                      <span>-</span>
                      <input
                        className="corte-field corte-timebox"
                        defaultValue={formatClock(cut.end)}
                        key={`${cut.cut_id}-end-${cut.end}`}
                        aria-label="Fim"
                        onBlur={(event) => {
                          const value = parseTimestampInput(event.target.value);
                          if (value === null || value === cut.end) return;
                          props.onCommitCut(cut.cut_id, { end: value });
                        }}
                      />
                    </span>
                    {titleEditId === cut.cut_id ? (
                      <input
                        className="corte-field"
                        autoFocus
                        defaultValue={cut.title || ""}
                        aria-label="Título do corte"
                        onBlur={(event) => {
                          setTitleEditId(null);
                          if ((event.target.value || "") === (cut.title || "")) return;
                          props.onCommitCut(cut.cut_id, { title: event.target.value });
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="corte-cut-title"
                        onClick={() => setTitleEditId(cut.cut_id)}
                      >
                        <span className="material-icons" style={{ fontSize: 16 }}>
                          edit
                        </span>
                        <strong>{cut.title || "Trecho sem título"}</strong>
                      </button>
                    )}
                    <button type="button" className="corte-adjust" onClick={() => props.onAdjustCut(cut)}>
                      Ajustar
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <button id="corte-render" type="button" className="corte-render" onClick={props.onRender}>
            <span className="material-icons" style={{ fontSize: 16 }}>
              movie
            </span>
            {props.isRendering ? "Renderizando" : "Renderizar cortes"}
          </button>

          {props.renderOutputs.length > 0 && (
            <div className="corte-stack">
              {props.renderOutputs.map((output) => {
                const fileName = output.split("/").pop() || output;
                return (
                  <div key={output} className="corte-output">
                    <span className="corte-video-copy">
                      <strong>{props.renderTitlesByFileName[fileName] || fileName}</strong>
                      <small>{fileName}</small>
                    </span>
                    <button type="button" className="corte-ghost" onClick={() => props.onOpenRenderFolder(fileName)}>
                      Abrir
                    </button>
                    <button type="button" className="corte-ghost" onClick={() => props.onDeleteRender(fileName)}>
                      Excluir
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {styleOpen && (
        <StylePresetPanel
          library={props.styleLibrary}
          activePreset={props.activePreset}
          onClose={() => setStyleOpen(false)}
          onSelect={props.onSelectPreset}
          onUpdate={props.onUpdatePreset}
          onCreate={props.onCreatePreset}
          onDuplicate={props.onDuplicatePreset}
          onRemove={props.onRemovePreset}
          onResetBuiltin={props.onResetPreset}
          onAddExtra={props.onAddExtra}
          onRemoveExtra={props.onRemoveExtra}
        />
      )}
    </div>
  );
}
