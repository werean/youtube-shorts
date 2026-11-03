import { useState } from "react";
import {
  CAPTION_FONTS,
  type BlurTarget,
  type CaptionPosition,
  type ExtraKind,
  type ShortStylePreset,
  type StyleLibrary,
} from "../../../../shared/stylePresets";

interface StylePresetPanelProps {
  library: StyleLibrary;
  activePreset?: ShortStylePreset;
  onClose: () => void;
  onSelect: (id: string) => void;
  onUpdate: (recipe: (preset: ShortStylePreset) => ShortStylePreset) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onResetBuiltin: () => void;
  onAddExtra: (label: string, kind: ExtraKind) => void;
  onRemoveExtra: (id: string) => void;
}

const BLUR_TARGETS: Array<{ id: BlurTarget; label: string }> = [
  { id: "background", label: "Fundo" },
  { id: "top", label: "Topo" },
  { id: "bottom", label: "Base" },
  { id: "custom", label: "Região" },
];

const CAPTION_POSITIONS: Array<{ id: CaptionPosition; label: string }> = [
  { id: "top", label: "Topo" },
  { id: "center", label: "Centro" },
  { id: "bottom", label: "Base" },
];

function Mark({ stored }: { stored?: boolean }) {
  return <span className={`corte-mark${stored ? "" : " file"}`}>{stored ? "Salvo" : "No arquivo"}</span>;
}

export function StylePresetPanel({
  library,
  activePreset,
  onClose,
  onSelect,
  onUpdate,
  onCreate,
  onDuplicate,
  onRemove,
  onResetBuiltin,
  onAddExtra,
  onRemoveExtra,
}: StylePresetPanelProps) {
  const [extraLabel, setExtraLabel] = useState("");
  const [extraKind, setExtraKind] = useState<ExtraKind>("toggle");
  const preset = activePreset;

  if (!preset) return null;

  const captionTop =
    preset.captions.position === "top" ? "12%" : preset.captions.position === "center" ? "46%" : "auto";
  const captionBottom = preset.captions.position === "bottom" ? "10%" : "auto";

  return (
    <div className="corte-overlay" onClick={onClose}>
      <section
        id="corte-style-panel"
        className="corte-style corte-glass"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="corte-head">
          <div>
            <h2 className="corte-title">Estilo do short</h2>
            <p className="corte-hint">
              O preset entra no comando do render. Sem desfoque, o fundo não é borrado. Com
              desfoque, valem o lugar e a intensidade. Música mistura o caminho da faixa. Legendas
              queimam a transcrição do corte.
            </p>
          </div>
          <button type="button" className="corte-adjust" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="corte-actions">
          <button type="button" className="corte-ghost" onClick={onCreate}>
            Novo
          </button>
          <button type="button" className="corte-ghost" onClick={onDuplicate}>
            Duplicar
          </button>
          <button type="button" className="corte-ghost" disabled={preset.builtin} onClick={onRemove}>
            Remover
          </button>
          {preset.builtin && (
            <button type="button" className="corte-ghost" onClick={onResetBuiltin}>
              Restaurar padrão
            </button>
          )}
        </div>

        <div className="corte-style-grid">
          <div className="corte-style-list">
            {library.presets.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`corte-preset${item.id === preset.id ? " active" : ""}`}
                onClick={() => onSelect(item.id)}
              >
                {item.name}
                <small>{item.builtin ? "Padrão" : "Personalizado"}</small>
              </button>
            ))}
          </div>

          <div className="corte-style-form">
            <label className="corte-stack">
              <span className="corte-kicker">Nome</span>
              <input
                className="corte-field"
                value={preset.name}
                onChange={(event) =>
                  onUpdate((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>

            <section className="corte-section">
              <div className="corte-inline">
                <h3>Desfoque</h3>
                <Mark />
              </div>
              <p className="corte-hint">
                Desligado, o quadro só é ajustado na vertical. Ligado, o desfoque usa o lugar e a
                intensidade daqui.
              </p>
              <div className="corte-inline">
                <span>Ativar no preset</span>
                <button
                  type="button"
                  className={`corte-switch${preset.blur.enabled ? " on" : ""}`}
                  aria-pressed={preset.blur.enabled}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      blur: { ...current.blur, enabled: !current.blur.enabled },
                    }))
                  }
                >
                  <i />
                </button>
              </div>
              <div className="corte-seg">
                {BLUR_TARGETS.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className={preset.blur.target === target.id ? "active" : ""}
                    onClick={() =>
                      onUpdate((current) => ({
                        ...current,
                        blur: { ...current.blur, target: target.id },
                      }))
                    }
                  >
                    {target.label}
                  </button>
                ))}
              </div>
              <label className="corte-stack">
                <span className="corte-hint">Intensidade {preset.blur.strength}</span>
                <input
                  className="corte-range"
                  type="range"
                  min={0}
                  max={40}
                  value={preset.blur.strength}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      blur: { ...current.blur, strength: Number(event.target.value) },
                    }))
                  }
                />
              </label>
              {preset.blur.target === "custom" && (
                <div className="corte-stack">
                  {(
                    [
                      ["x", "X"],
                      ["y", "Y"],
                      ["width", "Largura"],
                      ["height", "Altura"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="corte-stack">
                      <span className="corte-hint">
                        {label} {preset.blur.region[key]}%
                      </span>
                      <input
                        className="corte-range"
                        type="range"
                        min={key === "width" || key === "height" ? 1 : 0}
                        max={100}
                        value={preset.blur.region[key]}
                        onChange={(event) =>
                          onUpdate((current) => ({
                            ...current,
                            blur: {
                              ...current.blur,
                              region: {
                                ...current.blur.region,
                                [key]: Number(event.target.value),
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className="corte-section">
              <div className="corte-inline">
                <h3>Música de fundo</h3>
                <Mark />
              </div>
              <div className="corte-inline">
                <span>Ativar</span>
                <button
                  type="button"
                  className={`corte-switch${preset.music.enabled ? " on" : ""}`}
                  aria-pressed={preset.music.enabled}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      music: { ...current.music, enabled: !current.music.enabled },
                    }))
                  }
                >
                  <i />
                </button>
              </div>
              <label className="corte-stack">
                <span className="corte-hint">Caminho da faixa</span>
                <input
                  className="corte-field"
                  value={preset.music.trackName}
                  placeholder="Caminho do arquivo de áudio"
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      music: { ...current.music, trackName: event.target.value },
                    }))
                  }
                />
                <input
                  id="corte-music-file"
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    onUpdate((current) => ({
                      ...current,
                      music: { ...current.music, trackName: file.name, enabled: true },
                    }));
                  }}
                />
                <button
                  type="button"
                  className="corte-ghost"
                  onClick={() => document.getElementById("corte-music-file")?.click()}
                >
                  Escolher faixa
                </button>
              </label>
              <label className="corte-stack">
                <span className="corte-hint">Volume {preset.music.volume}%</span>
                <input
                  className="corte-range"
                  type="range"
                  min={0}
                  max={100}
                  value={preset.music.volume}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      music: { ...current.music, volume: Number(event.target.value) },
                    }))
                  }
                />
              </label>
            </section>

            <section className="corte-section">
              <div className="corte-inline">
                <h3>Legendas</h3>
                <Mark />
              </div>
              <div className="corte-inline">
                <span>Ativar</span>
                <button
                  type="button"
                  className={`corte-switch${preset.captions.enabled ? " on" : ""}`}
                  aria-pressed={preset.captions.enabled}
                  onClick={() =>
                    onUpdate((current) => ({
                      ...current,
                      captions: { ...current.captions, enabled: !current.captions.enabled },
                    }))
                  }
                >
                  <i />
                </button>
              </div>
              <label className="corte-stack">
                <span className="corte-hint">Fonte</span>
                <select
                  className="corte-field"
                  value={preset.captions.fontFamily}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      captions: { ...current.captions, fontFamily: event.target.value },
                    }))
                  }
                >
                  {CAPTION_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="corte-stack">
                <span className="corte-hint">Tamanho {preset.captions.fontSize}</span>
                <input
                  className="corte-range"
                  type="range"
                  min={18}
                  max={96}
                  value={preset.captions.fontSize}
                  onChange={(event) =>
                    onUpdate((current) => ({
                      ...current,
                      captions: { ...current.captions, fontSize: Number(event.target.value) },
                    }))
                  }
                />
              </label>
              <div className="corte-seg">
                {CAPTION_POSITIONS.map((position) => (
                  <button
                    key={position.id}
                    type="button"
                    className={preset.captions.position === position.id ? "active" : ""}
                    onClick={() =>
                      onUpdate((current) => ({
                        ...current,
                        captions: { ...current.captions, position: position.id },
                      }))
                    }
                  >
                    {position.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="corte-section">
              <div className="corte-inline">
                <h3>Filtros do render</h3>
                <Mark />
              </div>
              <p className="corte-hint">
                Texto vazio mantém a configuração atual do FFmpeg. Um valor entra no próximo render.
              </p>
              <label className="corte-stack">
                <span className="corte-hint">Filtro de vídeo</span>
                <input
                  className="corte-field"
                  value={preset.ffmpegVideoFilter}
                  placeholder="ex.: eq=contrast=1.04"
                  onChange={(event) =>
                    onUpdate((current) => ({ ...current, ffmpegVideoFilter: event.target.value }))
                  }
                />
              </label>
              <label className="corte-stack">
                <span className="corte-hint">Filtro de áudio</span>
                <input
                  className="corte-field"
                  value={preset.ffmpegAudioFilter}
                  placeholder="ex.: volume=1.0"
                  onChange={(event) =>
                    onUpdate((current) => ({ ...current, ffmpegAudioFilter: event.target.value }))
                  }
                />
              </label>
            </section>

            <section className="corte-section">
              <div className="corte-inline">
                <h3>Opções extras</h3>
                <Mark stored />
              </div>
              {preset.extras.map((extra) => (
                <div key={extra.id} className="corte-stage">
                  <span>{extra.label}</span>
                  {extra.kind === "toggle" ? (
                    <button
                      type="button"
                      className={`corte-switch${extra.enabled ? " on" : ""}`}
                      onClick={() =>
                        onUpdate((current) => ({
                          ...current,
                          extras: current.extras.map((item) =>
                            item.id === extra.id ? { ...item, enabled: !item.enabled } : item,
                          ),
                        }))
                      }
                    >
                      <i />
                    </button>
                  ) : (
                    <input
                      className="corte-field"
                      style={{ maxWidth: 140 }}
                      value={extra.value}
                      onChange={(event) =>
                        onUpdate((current) => ({
                          ...current,
                          extras: current.extras.map((item) =>
                            item.id === extra.id ? { ...item, value: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                  )}
                  <button type="button" className="corte-more" onClick={() => onRemoveExtra(extra.id)}>
                    <span className="material-icons">close</span>
                  </button>
                </div>
              ))}
              <div className="corte-actions">
                <input
                  className="corte-field"
                  style={{ flex: 1 }}
                  value={extraLabel}
                  placeholder="Nova opção"
                  onChange={(event) => setExtraLabel(event.target.value)}
                />
                <select
                  className="corte-field"
                  style={{ maxWidth: 120 }}
                  value={extraKind}
                  onChange={(event) => setExtraKind(event.target.value as ExtraKind)}
                >
                  <option value="toggle">Interruptor</option>
                  <option value="text">Texto</option>
                  <option value="number">Número</option>
                </select>
                <button
                  type="button"
                  className="corte-ghost"
                  onClick={() => {
                    onAddExtra(extraLabel, extraKind);
                    setExtraLabel("");
                  }}
                >
                  Adicionar
                </button>
              </div>
            </section>
          </div>

          <aside className="corte-style-preview">
            <p className="corte-kicker">Prévia do preset</p>
            <div className="corte-phone" aria-hidden="true">
              {preset.blur.enabled && preset.blur.target === "background" && (
                <div className="band" style={{ inset: 0, opacity: 0.35 }} />
              )}
              {preset.blur.enabled && preset.blur.target === "top" && (
                <div className="band" style={{ top: 0, height: "22%" }} />
              )}
              {preset.blur.enabled && preset.blur.target === "bottom" && (
                <div className="band" style={{ bottom: 0, height: "22%" }} />
              )}
              {preset.blur.enabled && preset.blur.target === "custom" && (
                <div
                  className="band"
                  style={{
                    left: `${preset.blur.region.x}%`,
                    top: `${preset.blur.region.y}%`,
                    width: `${preset.blur.region.width}%`,
                    height: `${preset.blur.region.height}%`,
                  }}
                />
              )}
              {preset.music.enabled && <div className="music">♪ {preset.music.volume}%</div>}
              {preset.captions.enabled && (
                <div
                  className="caption"
                  style={{
                    top: captionTop,
                    bottom: captionBottom,
                    fontFamily: preset.captions.fontFamily,
                    fontSize: Math.max(12, Math.round(preset.captions.fontSize / 4)),
                  }}
                >
                  Legenda
                </div>
              )}
            </div>
            <p className="corte-hint">Diagrama do preset. O player do vídeo continua colorido.</p>
          </aside>
        </div>
      </section>
    </div>
  );
}
