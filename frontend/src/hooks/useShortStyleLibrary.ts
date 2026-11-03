import { useEffect, useMemo, useRef, useState } from "react";
import { saveSettings, type AppSettings } from "../api/config";
import {
  blankStylePreset,
  createBuiltinPresets,
  defaultStyleLibrary,
  normalizeStyleLibrary,
  type ExtraKind,
  type ShortStylePreset,
  type StyleExtra,
  type StyleLibrary,
} from "../../../shared/stylePresets";

const STORAGE_KEY = "corte.style-library";

function readLocal(): StyleLibrary | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeStyleLibrary(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocal(library: StyleLibrary) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch {
    console.warn("[style] Não foi possível gravar o preset neste navegador.");
  }
}

function hasCustom(library: StyleLibrary): boolean {
  return library.presets.some((preset) => !preset.builtin);
}

export function useShortStyleLibrary(
  appSettings: AppSettings | null,
  onSettings: (settings: AppSettings) => void,
) {
  const [library, setLibrary] = useState<StyleLibrary>(() => readLocal() ?? defaultStyleLibrary());
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const hydrated = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const activePreset = useMemo(
    () => library.presets.find((preset) => preset.id === library.activeId) ?? library.presets[0],
    [library],
  );

  async function persist(next: StyleLibrary, immediate = false) {
    const normalized = normalizeStyleLibrary(next);
    libraryRef.current = normalized;
    setLibrary(normalized);
    writeLocal(normalized);

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    const send = async () => {
      try {
        const updated = await saveSettings({ style_library: normalized });
        onSettings(updated);
      } catch (error) {
        console.error("[style] Falha ao salvar presets nas configurações:", error);
      }
    };

    if (immediate) {
      await send();
      return;
    }

    saveTimer.current = window.setTimeout(() => {
      void send();
    }, 400);
  }

  useEffect(() => {
    if (!appSettings || hydrated.current) return;
    hydrated.current = true;

    const local = readLocal();
    if (appSettings.style_library) {
      const server = normalizeStyleLibrary(appSettings.style_library);
      if (local && hasCustom(local) && !hasCustom(server)) {
        void persist(local, true);
        return;
      }
      setLibrary(server);
      writeLocal(server);
      return;
    }

    if (local) {
      void persist(local, true);
    }
  }, [appSettings]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  function selectPreset(id: string) {
    const current = libraryRef.current;
    if (!current.presets.some((preset) => preset.id === id)) return;
    void persist({ ...current, activeId: id }, true);
  }

  function updateActive(recipe: (preset: ShortStylePreset) => ShortStylePreset) {
    const current = libraryRef.current;
    const active = current.presets.find((preset) => preset.id === current.activeId);
    if (!active) return;
    const nextPreset = recipe(active);
    void persist({
      ...current,
      presets: current.presets.map((preset) => (preset.id === active.id ? nextPreset : preset)),
    });
  }

  function createPreset() {
    const created = blankStylePreset("Novo preset");
    void persist(
      { activeId: created.id, presets: [...libraryRef.current.presets, created] },
      true,
    );
  }

  function duplicateActive() {
    const current = libraryRef.current;
    const active = current.presets.find((preset) => preset.id === current.activeId);
    if (!active) return;
    const copy: ShortStylePreset = {
      ...active,
      id: `custom-${Date.now()}`,
      name: `${active.name} (cópia)`,
      builtin: false,
      blur: { ...active.blur, region: { ...active.blur.region } },
      music: { ...active.music },
      captions: { ...active.captions },
      extras: active.extras.map((item) => ({ ...item })),
    };
    void persist({ activeId: copy.id, presets: [...current.presets, copy] }, true);
  }

  function removeActive() {
    const current = libraryRef.current;
    const active = current.presets.find((preset) => preset.id === current.activeId);
    if (!active || active.builtin) return;
    const presets = current.presets.filter((preset) => preset.id !== active.id);
    void persist(
      {
        activeId: presets[0]?.id ?? "classic",
        presets,
      },
      true,
    );
  }

  function resetActiveBuiltin() {
    const current = libraryRef.current;
    const active = current.presets.find((preset) => preset.id === current.activeId);
    if (!active?.builtin) return;
    const fresh = createBuiltinPresets().find((preset) => preset.id === active.id);
    if (!fresh) return;
    void persist(
      {
        ...current,
        presets: current.presets.map((preset) => (preset.id === fresh.id ? fresh : preset)),
      },
      true,
    );
  }

  function addExtra(label: string, kind: ExtraKind) {
    const extra: StyleExtra = {
      id: `extra-${Date.now()}`,
      label: label.trim() || "Nova opção",
      kind,
      enabled: true,
      value: kind === "number" ? "0" : "",
    };
    updateActive((preset) => ({ ...preset, extras: [...preset.extras, extra] }));
  }

  function removeExtra(extraId: string) {
    updateActive((preset) => ({
      ...preset,
      extras: preset.extras.filter((item) => item.id !== extraId),
    }));
  }

  async function flush() {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await persist(libraryRef.current, true);
  }

  return {
    library,
    activePreset,
    selectPreset,
    updateActive,
    createPreset,
    duplicateActive,
    removeActive,
    resetActiveBuiltin,
    addExtra,
    removeExtra,
    flush,
  };
}
