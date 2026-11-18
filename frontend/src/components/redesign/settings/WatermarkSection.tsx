import { SpinnerGap, Stamp, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WatermarkMode, WatermarkPosition } from "@youtube-shorts/contracts";
import { buildWatermarkImageUrl } from "../../../api/watermark";
import type { UseWatermarkResult } from "../../../hooks/useWatermark";
import {
  GhostButton,
  PositionGrid,
  SegmentedChoice,
  SettingsSectionLabel,
  SettingsSlider,
  SETTINGS_CARD_CLASS,
  type AutoSaveReporter,
} from "./settingsShared";

/* -------------------------------------------------------------------------- */
/* Matemática de posição e tamanho (a mesma do FFmpeg; architecture.md, 11.4)  */
/* -------------------------------------------------------------------------- */

const VIDEO_W = 1080;
const VIDEO_H = 1920;
const WATERMARK_BOX_H = 480;
const WATERMARK_MARGIN = 44;

export interface WatermarkPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Retângulo da marca num quadro de 1080×1920, igual ao que o FFmpeg produz. */
export function computeWatermarkPlacement(
  position: WatermarkPosition,
  sizePercent: number,
  imageWidth: number,
  imageHeight: number,
): WatermarkPlacement {
  const boxW = Math.floor((VIDEO_W * sizePercent) / 100 / 2 + 0.5) * 2;

  const iw = imageWidth > 0 ? imageWidth : 1;
  const ih = imageHeight > 0 ? imageHeight : 1;
  const scale = Math.min(boxW / iw, WATERMARK_BOX_H / ih);
  const w = iw * scale;
  const h = ih * scale;

  const horizontal = position.endsWith("left") ? "left" : position.endsWith("right") ? "right" : "center";
  const vertical = position.startsWith("top") ? "top" : position.startsWith("bottom") ? "bottom" : "middle";

  const x =
    horizontal === "left"
      ? WATERMARK_MARGIN
      : horizontal === "center"
        ? (VIDEO_W - w) / 2
        : VIDEO_W - w - WATERMARK_MARGIN;
  const y =
    vertical === "top"
      ? WATERMARK_MARGIN
      : vertical === "middle"
        ? (VIDEO_H - h) / 2
        : VIDEO_H - h - WATERMARK_MARGIN;

  return { x, y, w, h };
}

/* -------------------------------------------------------------------------- */
/* Utilitários                                                                 */
/* -------------------------------------------------------------------------- */

const MODE_OPTIONS: ReadonlyArray<{ value: WatermarkMode; label: string }> = [
  { value: "always", label: "Em todos os vídeos" },
  { value: "never", label: "Em nenhum" },
  { value: "ask", label: "Perguntar antes" },
];

const MODE_DESCRIPTIONS: Record<WatermarkMode, string> = {
  always: "Todo corte gerado sai com a marca d'água.",
  never: "Os cortes saem sem marca d'água.",
  ask: "O app pergunta toda vez que for gerar os vídeos.",
};

const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const INVALID_IMAGE_TEXT = "Use uma imagem PNG, JPG ou WebP.";
const SLIDER_DEBOUNCE_MS = 300;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const POPOVER_BUTTON_CLASS =
  "h-7 rounded-pill px-2.5 text-xs font-medium text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast";

/** Confirmação presa ao botão "Remover", no padrão do `RestoreDefaultsButton`. */
function RemoveImageButton({
  disabled,
  onConfirm,
}: {
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();

    const handlePointerOutside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !wrapperRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-pill border border-line-strong bg-transparent px-3 text-sm font-medium text-text-2 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1 disabled:pointer-events-none disabled:opacity-50"
      >
        Remover
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Remover a marca d'água?"
          className="absolute right-0 top-full z-[90] mt-2 w-[264px] max-w-[calc(100vw-24px)] glass--strong rounded-card p-3 shadow-pop"
        >
          <p className="text-xs font-medium leading-snug text-text-1">Remover a marca d'água?</p>
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <button
              ref={cancelRef}
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={POPOVER_BUTTON_CLASS}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
              className="h-7 rounded-pill bg-accent px-3 text-xs font-medium text-white transition-colors duration-fast hover:bg-accent-hover active:bg-accent-active"
            >
              Remover
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Seção — Marca d'água                                                        */
/* -------------------------------------------------------------------------- */

export interface WatermarkSectionProps {
  watermark: UseWatermarkResult;
  reporter?: AutoSaveReporter;
}

export function WatermarkSection({ watermark, reporter }: WatermarkSectionProps) {
  const { settings, loading, loadError, uploading } = watermark;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);

  const [opacityDraft, setOpacityDraft] = useState(0.7);
  const [sizeDraft, setSizeDraft] = useState(18);
  const [positionDraft, setPositionDraft] = useState<WatermarkPosition>("top-right");
  const pendingSaves = useRef(0);
  const debounceRef = useRef<number | null>(null);

  // Sincroniza os controles com o servidor quando não há salvamento pendente.
  useEffect(() => {
    if (!settings || pendingSaves.current > 0 || debounceRef.current !== null) return;
    setOpacityDraft(settings.opacity);
    setSizeDraft(settings.size_percent);
    setPositionDraft(settings.position);
  }, [settings]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  const hasImage = Boolean(settings?.has_image);
  const imageUrl = useMemo(() => buildWatermarkImageUrl(settings?.image_url), [settings?.image_url]);

  async function persistPatch(patch: Parameters<UseWatermarkResult["save"]>[0]): Promise<boolean> {
    pendingSaves.current += 1;
    reporter?.reportSaving();
    try {
      await watermark.save(patch);
      reporter?.reportSaved();
      return true;
    } catch (error) {
      reporter?.reportError(errorMessage(error, "Erro ao salvar"));
      return false;
    } finally {
      pendingSaves.current -= 1;
    }
  }

  function scheduleAppearanceSave(patch: { opacity?: number; size_percent?: number }) {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void persistPatch(patch).then((ok) => {
        if (!ok && settings) {
          setOpacityDraft(settings.opacity);
          setSizeDraft(settings.size_percent);
        }
      });
    }, SLIDER_DEBOUNCE_MS);
  }

  function handleOpacityChange(transparencyPercent: number) {
    const opacity = Number(((100 - transparencyPercent) / 100).toFixed(2));
    setOpacityDraft(opacity);
    scheduleAppearanceSave({ opacity, size_percent: sizeDraft });
  }

  function handleSizeChange(next: number) {
    setSizeDraft(next);
    scheduleAppearanceSave({ opacity: opacityDraft, size_percent: next });
  }

  async function handlePositionChange(next: WatermarkPosition) {
    if (next === positionDraft) return;
    const previous = positionDraft;
    setPositionDraft(next);
    const ok = await persistPatch({ position: next });
    if (!ok) setPositionDraft(previous);
  }

  async function handleModeChange(next: WatermarkMode) {
    setHighlightMode(false);
    if (!settings || next === settings.mode) return;
    await persistPatch({ mode: next });
  }

  async function handleFile(file: File | null | undefined) {
    if (!file || uploading) return;
    if (file.type && !file.type.startsWith("image/")) {
      setUploadError(INVALID_IMAGE_TEXT);
      return;
    }
    setUploadError(null);
    const hadImage = hasImage;
    try {
      const next = await watermark.uploadImage(file);
      // P21: enviar a imagem não liga a marca; só destaca a escolha do modo.
      if (!hadImage && next.mode === "never") setHighlightMode(true);
    } catch (error) {
      setUploadError(errorMessage(error, "Não foi possível ler a imagem."));
    }
  }

  async function handleRemove() {
    setUploadError(null);
    setHighlightMode(false);
    reporter?.reportSaving();
    try {
      await watermark.removeImage();
      reporter?.reportSaved();
    } catch (error) {
      reporter?.reportError(errorMessage(error, "Não foi possível remover a imagem."));
    }
  }

  /* ----------------------------- Carregando / erro ----------------------------- */

  if (!settings) {
    return (
      <div className="flex flex-col gap-7">
        <section>
          <SettingsSectionLabel>Imagem</SettingsSectionLabel>
          <div className={`${SETTINGS_CARD_CLASS} flex items-center justify-between gap-4 px-4 py-3.5`}>
            {loading ? (
              <p role="status" className="flex items-center gap-2 text-sm text-text-3">
                <SpinnerGap size={14} weight="regular" className="animate-spin" aria-hidden="true" />
                Carregando…
              </p>
            ) : (
              <>
                <p role="alert" className="text-sm text-danger">
                  {loadError || "Não foi possível carregar a marca d'água."}
                </p>
                <GhostButton onClick={() => void watermark.refresh()}>Tentar de novo</GhostButton>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  /* ------------------------------- Prévia ------------------------------- */

  const previewScale = 180 / VIDEO_W;
  const placement = computeWatermarkPlacement(
    positionDraft,
    sizeDraft,
    settings.image?.width ?? 1,
    settings.image?.height ?? 1,
  );
  const transparencyPercent = Math.round((1 - opacityDraft) * 100);
  const modeHelp = !hasImage
    ? "Envie uma imagem para ativar."
    : highlightMode && settings.mode === "never"
      ? "A marca d'água ainda está desligada. Escolha quando usar."
      : MODE_DESCRIPTIONS[settings.mode];

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SettingsSectionLabel>Imagem</SettingsSectionLabel>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void handleFile(event.dataTransfer.files?.[0]);
          }}
          className={[
            "flex items-center gap-4 px-4 py-3.5 transition-colors duration-fast",
            isDragging
              ? "rounded-card border border-dashed border-accent bg-accent/10"
              : SETTINGS_CARD_CLASS,
          ].join(" ")}
        >
          <span
            aria-hidden={hasImage ? undefined : true}
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-white/[0.04]"
          >
            {hasImage && imageUrl ? (
              <img
                src={imageUrl}
                alt="Marca d'água atual"
                className="h-full w-full object-contain"
              />
            ) : (
              <Stamp size={22} weight="regular" className="text-text-3" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-base text-text-1">{hasImage ? "Imagem enviada" : "Nenhuma imagem"}</p>
            <p className="mt-0.5 text-sm text-text-2">
              {hasImage && settings.image
                ? `${settings.image.width} × ${settings.image.height} px`
                : "Envie o seu logotipo em PNG, JPG ou WebP. PNG com fundo transparente fica melhor."}
            </p>
            {uploadError && (
              <p role="alert" className="mt-1 text-sm text-danger">
                {uploadError}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <GhostButton
              variant={hasImage ? "default" : "accent"}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              leadingIcon={
                uploading ? (
                  <SpinnerGap size={14} weight="regular" className="animate-spin" />
                ) : (
                  <UploadSimple size={14} weight="regular" />
                )
              }
            >
              {uploading ? "Enviando…" : hasImage ? "Trocar imagem" : "Enviar imagem"}
            </GhostButton>
            {hasImage && <RemoveImageButton disabled={uploading} onConfirm={() => void handleRemove()} />}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void handleFile(file);
            }}
          />
        </div>
      </section>

      <section>
        <SettingsSectionLabel>Quando usar</SettingsSectionLabel>
        <div
          className={[
            SETTINGS_CARD_CLASS,
            "flex flex-col gap-2.5 px-4 py-3.5",
            highlightMode ? "ring-2 ring-accent-ring" : "",
          ].join(" ")}
        >
          <SegmentedChoice
            ariaLabel="Quando usar a marca d'água"
            options={MODE_OPTIONS}
            value={settings.mode}
            disabled={!hasImage}
            onChange={(next) => void handleModeChange(next)}
          />
          <p
            className={[
              "text-sm",
              highlightMode && hasImage && settings.mode === "never" ? "text-warning" : "text-text-2",
            ].join(" ")}
          >
            {modeHelp}
          </p>
        </div>
      </section>

      <section>
        <SettingsSectionLabel>Aparência</SettingsSectionLabel>
        <div className={`${SETTINGS_CARD_CLASS} flex flex-wrap items-start gap-6 px-4 py-3.5`}>
          <div className="flex min-w-[220px] flex-1 flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-2">Transparência</span>
              <SettingsSlider
                min={0}
                max={95}
                step={5}
                value={transparencyPercent}
                disabled={!hasImage}
                onChange={handleOpacityChange}
                ariaLabel="Transparência"
                ariaValueText={`${transparencyPercent} por cento`}
                valueLabel={`${transparencyPercent}%`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-2">Tamanho</span>
              <SettingsSlider
                min={5}
                max={50}
                step={1}
                value={sizeDraft}
                disabled={!hasImage}
                onChange={handleSizeChange}
                ariaLabel="Tamanho"
                ariaValueText={`${sizeDraft} por cento`}
                valueLabel={`${sizeDraft}%`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-text-2">Posição</span>
              <PositionGrid
                value={positionDraft}
                disabled={!hasImage}
                onChange={(next) => void handlePositionChange(next)}
              />
            </div>
          </div>

          <figure className="m-0 flex flex-col items-center gap-2">
            <div
              aria-hidden="true"
              className="relative h-[320px] w-[180px] overflow-hidden rounded-card border border-line bg-bg-2"
            >
              <div className="absolute inset-x-3 top-[66%] h-8 rounded-thumb bg-white/[0.12]" />
              {hasImage && imageUrl && (
                <img
                  src={imageUrl}
                  alt=""
                  draggable={false}
                  className="absolute max-w-none object-contain"
                  style={{
                    left: placement.x * previewScale,
                    top: placement.y * previewScale,
                    width: placement.w * previewScale,
                    height: placement.h * previewScale,
                    opacity: opacityDraft,
                  }}
                />
              )}
            </div>
            <figcaption className="text-xs text-text-3">Prévia aproximada.</figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}
