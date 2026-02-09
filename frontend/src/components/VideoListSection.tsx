import { useState } from "react";
import type { VideoItem } from "../hooks";
import { archiveVideo, deleteVideo, renameVideo } from "../api";
import type { ActionState } from "../hooks/useAppAction";

interface VideoListSectionProps {
  videos: VideoItem[];
  archivedVideos: VideoItem[];
  activeVideoId: string | null;
  videoView: "active" | "archived";
  action: ActionState;
  onSelectVideo: (videoId: string | null) => void;
  onSetView: (view: "active" | "archived") => void;
  onLoadVideos: () => Promise<void>;
  onShowRenameDialog: (videoId: string, currentName: string) => void;
  onRunAction: <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => void;
}

export function VideoListSection({
  videos,
  archivedVideos,
  activeVideoId,
  videoView,
  action,
  onSelectVideo,
  onSetView,
  onLoadVideos,
  onShowRenameDialog,
  onRunAction,
}: VideoListSectionProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const displayedVideos = videoView === "active" ? videos : archivedVideos;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>2. Seus vídeos</h2>
        <div className="view-tabs">
          <button
            className={`tab ${videoView === "active" ? "active" : ""}`}
            onClick={() => onSetView("active")}
          >
            Seus vídeos
          </button>
          <button
            className={`tab ${videoView === "archived" ? "active" : ""}`}
            onClick={() => onSetView("archived")}
          >
            Arquivados
          </button>
        </div>
      </div>

      {displayedVideos.length === 0 ? (
        <p className="muted">
          {videoView === "active"
            ? "Nenhum vídeo ainda. Faça upload de um para começar."
            : "Nenhum vídeo arquivado."}
        </p>
      ) : (
        <div className="video-list">
          {displayedVideos
            .slice()
            .reverse()
            .map((video, index) => (
              <div key={video.job.job_id} className="video-item">
                <div
                  className="video-row"
                  onClick={() => {
                    if (videoView === "active") {
                      if (activeVideoId === video.job.job_id) {
                        onSelectVideo(null);
                      } else {
                        onSelectVideo(video.job.job_id);
                      }
                    }
                  }}
                  style={{
                    cursor: videoView === "active" ? "pointer" : "default",
                  }}
                >
                  {videoView === "active" ? (
                    <label
                      className="video-checkbox"
                      style={{ cursor: "pointer", pointerEvents: "none" }}
                    >
                      <input
                        type="checkbox"
                        checked={activeVideoId === video.job.job_id}
                        readOnly
                        style={{ pointerEvents: "none" }}
                      />
                      <span>
                        {index + 1} - {video.job.video_name || "Sem nome"}
                      </span>
                    </label>
                  ) : (
                    <div className="video-label">
                      <span>
                        {index + 1} - {video.job.video_name || "Sem nome"}
                      </span>
                    </div>
                  )}

                  <button
                    className="menu-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((current) =>
                        current === video.job.job_id ? null : video.job.job_id,
                      );
                    }}
                  >
                    ...
                  </button>
                </div>

                {menuOpenId === video.job.job_id && (
                  <div className="menu-popover">
                    {videoView === "active" && (
                      <>
                        <button
                          onClick={() => {
                            onShowRenameDialog(video.job.job_id, video.job.video_name || "");
                            setMenuOpenId(null);
                          }}
                        >
                          Renomear
                        </button>
                        <button
                          onClick={() =>
                            onRunAction(
                              () => archiveVideo(video.job.job_id),
                              () => {
                                if (activeVideoId === video.job.job_id) {
                                  onSelectVideo(null);
                                }
                                setMenuOpenId(null);
                                onLoadVideos();
                              },
                            )
                          }
                        >
                          Arquivar
                        </button>
                      </>
                    )}
                    <button
                      className="danger"
                      onClick={() =>
                        onRunAction(
                          () => deleteVideo(video.job.job_id),
                          () => {
                            if (activeVideoId === video.job.job_id) {
                              onSelectVideo(null);
                            }
                            setMenuOpenId(null);
                            onLoadVideos();
                          },
                        )
                      }
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
