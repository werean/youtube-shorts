import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildWatermarkImageUrl,
  deleteWatermarkImage,
  getWatermark,
  restoreWatermarkDefaults,
  updateWatermark,
  uploadWatermarkImage,
  type WatermarkPatch,
  type WatermarkSettings,
} from "../api/watermark";

export interface WatermarkRenderDecision {
  /** `false` quando o usuário cancelou a pergunta: nada deve ser gerado. */
  proceed: boolean;
  /** Valor do campo `watermark` do pedido; `undefined` = o servidor decide pelo modo. */
  watermark?: boolean;
}

export interface WatermarkAskState {
  open: boolean;
  imageUrl: string | null;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Estado da marca d'água do perfil ativo e da pergunta feita antes de cada
 * renderização quando o modo é "Perguntar antes".
 */
export function useWatermark() {
  const [settings, setSettings] = useState<WatermarkSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const settingsRef = useRef<WatermarkSettings | null>(null);
  const askResolverRef = useRef<((decision: WatermarkRenderDecision) => void) | null>(null);

  const apply = useCallback((next: WatermarkSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setLoadError(null);
  }, []);

  const refresh = useCallback(async (): Promise<WatermarkSettings | null> => {
    try {
      const next = await getWatermark();
      apply(next);
      return next;
    } catch (error) {
      setLoadError(errorText(error, "Não foi possível carregar a marca d'água."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Salva um patch e devolve a resposta do servidor. Lança em caso de erro. */
  const save = useCallback(
    async (patch: WatermarkPatch): Promise<WatermarkSettings> => {
      const next = await updateWatermark(patch);
      apply(next);
      return next;
    },
    [apply],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<WatermarkSettings> => {
      setUploading(true);
      try {
        const next = await uploadWatermarkImage(file);
        apply(next);
        return next;
      } finally {
        setUploading(false);
      }
    },
    [apply],
  );

  const removeImage = useCallback(async (): Promise<WatermarkSettings> => {
    const next = await deleteWatermarkImage();
    apply(next);
    return next;
  }, [apply]);

  const restoreDefaults = useCallback(async (): Promise<WatermarkSettings> => {
    const next = await restoreWatermarkDefaults();
    apply(next);
    return next;
  }, [apply]);

  function finishAsk(decision: WatermarkRenderDecision) {
    const resolve = askResolverRef.current;
    askResolverRef.current = null;
    setAskOpen(false);
    resolve?.(decision);
  }

  /**
   * Decide o campo `watermark` de uma renderização. Fora do modo "Perguntar antes"
   * (ou sem imagem) devolve `{ proceed: true }` sem tocar na tela; no modo "ask"
   * abre a pergunta e espera a resposta. Uma pergunta por clique, não por corte.
   */
  const resolveForRender = useCallback(async (): Promise<WatermarkRenderDecision> => {
    const current = (await refresh()) ?? settingsRef.current;
    if (!current || current.mode !== "ask" || !current.has_image) {
      return { proceed: true };
    }
    if (askResolverRef.current) {
      return { proceed: false };
    }
    return new Promise<WatermarkRenderDecision>((resolve) => {
      askResolverRef.current = resolve;
      setAskOpen(true);
    });
  }, [refresh]);

  const answerAsk = useCallback(
    async (add: boolean, dontAskAgain: boolean) => {
      if (dontAskAgain) {
        try {
          await save({ mode: add ? "always" : "never" });
        } catch (error) {
          // A resposta vale para esta renderização mesmo se o modo não pôde ser salvo.
          console.error("[watermark] Falha ao salvar o modo:", error);
        }
      }
      finishAsk({ proceed: true, watermark: add });
    },
    [save],
  );

  const cancelAsk = useCallback(() => {
    finishAsk({ proceed: false });
  }, []);

  // Se o app desmontar com a pergunta aberta, cancela o clique original.
  useEffect(() => {
    return () => {
      askResolverRef.current?.({ proceed: false });
      askResolverRef.current = null;
    };
  }, []);

  const ask: WatermarkAskState = { open: askOpen, imageUrl: buildWatermarkImageUrl(settings?.image_url) };

  return {
    settings,
    loading,
    loadError,
    uploading,
    ask,
    refresh,
    save,
    uploadImage,
    removeImage,
    restoreDefaults,
    resolveForRender,
    answerAsk,
    cancelAsk,
  };
}

export type UseWatermarkResult = ReturnType<typeof useWatermark>;
