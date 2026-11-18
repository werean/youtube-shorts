import {
  CaretDown,
  CaretRight,
  Globe,
  Lightning,
  Medal,
  Scales,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  WHISPER_LANGUAGES,
  WHISPER_MODELS,
  WHISPER_OUTPUT_FORMATS,
  type WhisperConfig,
  type WhisperModelSpec,
} from "../../../types/whisper";
import { generateWhisperCommand } from "../../../utils/whisperCommandBuilder";
import {
  FormatChip,
  PickTile,
  PickTileGroup,
  SettingsSectionLabel,
  type AutoSaveReporter,
} from "./settingsShared";

/* -------------------------------------------------------------------------- */
/* Contrato compartilhado das seções de Transcrição (Whisper)                 */
/* -------------------------------------------------------------------------- */

export interface WhisperSectionsProps {
  whisperConfig: Partial<WhisperConfig> | null;
  whisperDevice: "cpu" | "cuda";
  whisperFormats: string[];
  onSaveWhisper: (patch: Partial<WhisperConfig>) => Promise<void> | void;
  reporter?: AutoSaveReporter;
}

const DEBOUNCE_MS = 500;

const INDIVIDUAL_FORMAT_IDS = ["json", "vtt", "txt", "srt", "tsv"] as const;

const COMMON_LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: "pt", label: "Português" },
  { code: "en", label: "Inglês" },
  { code: "es", label: "Espanhol" },
  { code: "fr", label: "Francês" },
  { code: "de", label: "Alemão" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "Japonês" },
];

const MODEL_PRESETS: ReadonlyArray<{
  id: "small" | "turbo" | "large-v3";
  title: string;
  subtitle: string;
  icon: "lightning" | "scales" | "medal";
}> = [
  {
    id: "small",
    title: "Rápido",
    subtitle: "Pequeno e rápido.",
    icon: "lightning",
  },
  {
    id: "turbo",
    title: "Equilibrado",
    subtitle: "Rápido com ótima qualidade.",
    icon: "scales",
  },
  {
    id: "large-v3",
    title: "Preciso",
    subtitle: "Maior precisão.",
    icon: "medal",
  },
];

function formatRangeDash(value: string): string {
  return value.replace(/-/g, "–");
}

function getModelSpec(modelId: WhisperModelSpec["id"]): WhisperModelSpec | undefined {
  return WHISPER_MODELS.find((m) => m.id === modelId);
}

async function persistWhisperPatch(
  onSaveWhisper: (patch: Partial<WhisperConfig>) => Promise<void> | void,
  reporter: AutoSaveReporter | undefined,
  patch: Partial<WhisperConfig>,
): Promise<void> {
  reporter?.reportSaving();
  try {
    await onSaveWhisper(patch);
    reporter?.reportSaved();
  } catch (err) {
    reporter?.reportError(err instanceof Error ? err.message : undefined);
  }
}

const FIELD_INPUT_CLASS =
  "w-full h-9 rounded-item border border-line-strong bg-white/[0.03] px-3 font-sans text-xs text-text-1 tabular-nums placeholder:text-text-3 focus:border-[rgba(91,156,255,0.65)] focus:outline-none transition-colors duration-fast";

const FIELD_SELECT_CLASS =
  "w-full h-9 appearance-none bg-none rounded-item border border-line-strong bg-[#12141a] pl-3 !pr-8 font-sans text-xs text-text-1 tabular-nums focus:border-[rgba(91,156,255,0.65)] focus:outline-none transition-colors duration-fast cursor-pointer [color-scheme:dark] [&::-ms-expand]:hidden";

function cleanStr(v: unknown, fallback = ""): string {
  return v !== undefined && v !== null && v !== "null" ? String(v) : fallback;
}

function parseOptionalFloat(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseFloat(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseOptionalInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/* -------------------------------------------------------------------------- */
/* Tela 07 — Transcrição · Modelo (`whisper-model`)                           */
/* -------------------------------------------------------------------------- */

export function WhisperModelSection({
  whisperConfig,
  whisperDevice,
  onSaveWhisper,
  reporter,
}: WhisperSectionsProps) {
  const activeModel = whisperConfig?.model;
  const activeDevice: "cpu" | "cuda" = whisperConfig?.device ?? whisperDevice ?? "cuda";

  const handleSelectModel = (model: "small" | "turbo" | "large-v3") => {
    void persistWhisperPatch(onSaveWhisper, reporter, { model });
  };

  const handleSelectDevice = (device: "cpu" | "cuda") => {
    void persistWhisperPatch(onSaveWhisper, reporter, { device });
  };

  return (
    <div className="space-y-6">
      <section aria-label="Qualidade da transcrição">
        <SettingsSectionLabel>QUALIDADE DA TRANSCRIÇÃO</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {MODEL_PRESETS.map((preset) => {
            const spec = getModelSpec(preset.id);
            const isSelected = activeModel === preset.id;

            return (
              <PickTile
                key={preset.id}
                selected={isSelected}
                onSelect={() => handleSelectModel(preset.id)}
                actionLabel="Usar este nível"
                ariaLabel={`${preset.title} (${spec?.label ?? preset.id})`}
              >
                <div className="w-8 h-8 rounded-lg border border-line bg-white/[0.04] text-text-2 flex items-center justify-center">
                  {preset.icon === "lightning" && <Lightning size={16} weight="regular" />}
                  {preset.icon === "scales" && <Scales size={16} weight="regular" />}
                  {preset.icon === "medal" && <Medal size={16} weight="regular" />}
                </div>

                <div className="mt-3 text-md font-semibold text-text-1">{preset.title}</div>
                <div className="mt-0.5 text-xs text-text-2">{preset.subtitle}</div>

                {spec && (
                  <div className="mt-4 space-y-1 text-xs text-text-3 tabular-nums">
                    <div>{spec.vram_required} de memória de vídeo</div>
                    <div>{formatRangeDash(spec.ram_required)} de RAM</div>
                    <div>{formatRangeDash(spec.time_1h_audio)} por hora de áudio</div>
                  </div>
                )}
              </PickTile>
            );
          })}
        </PickTileGroup>
      </section>

      <section aria-label="Onde processar">
        <SettingsSectionLabel>ONDE PROCESSAR</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickTile
            selected={activeDevice === "cpu"}
            onSelect={() => handleSelectDevice("cpu")}
            ariaLabel="Processador (CPU)"
          >
            <div className="text-sm font-semibold text-text-1">Processador (CPU)</div>
            <div className="mt-1 text-xs text-text-2">
              Funciona em qualquer computador, mas é bem mais lento.
            </div>
          </PickTile>

          <PickTile
            selected={activeDevice === "cuda"}
            onSelect={() => handleSelectDevice("cuda")}
            ariaLabel="Placa de vídeo (CUDA)"
          >
            <div className="text-sm font-semibold text-text-1">Placa de vídeo (CUDA)</div>
            <div className="mt-1 text-xs text-text-2">
              Muito mais rápido em placas NVIDIA.
            </div>
          </PickTile>
        </PickTileGroup>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 08 — Transcrição · Idioma (`whisper-language`)                        */
/* -------------------------------------------------------------------------- */

export function WhisperLanguageSection({
  whisperConfig,
  onSaveWhisper,
  reporter,
}: WhisperSectionsProps) {
  const languageSelectId = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);

  const activeTask: "transcribe" | "translate" = whisperConfig?.task ?? "transcribe";
  const activeLanguage = cleanStr(whisperConfig?.language);
  const hasSpecificLanguage = Boolean(activeLanguage);

  const handleSelectTask = (task: "transcribe" | "translate") => {
    void persistWhisperPatch(onSaveWhisper, reporter, { task });
  };

  const handleAutoDetect = () => {
    void persistWhisperPatch(onSaveWhisper, reporter, { language: "" });
  };

  const handleChooseLanguageTile = () => {
    selectRef.current?.focus();
    if (!activeLanguage) {
      void persistWhisperPatch(onSaveWhisper, reporter, { language: "pt" });
    }
  };

  const handleSelectLanguage = (language: string) => {
    void persistWhisperPatch(onSaveWhisper, reporter, { language });
  };

  return (
    <div className="space-y-6">
      <section aria-label="Tarefa">
        <SettingsSectionLabel>TAREFA</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickTile
            selected={activeTask === "transcribe"}
            onSelect={() => handleSelectTask("transcribe")}
            ariaLabel="Transcrever"
          >
            <div className="text-sm font-semibold text-text-1">Transcrever</div>
            <div className="mt-1 text-xs text-text-2">
              Converte a fala em texto, no idioma falado.
            </div>
          </PickTile>

          <PickTile
            selected={activeTask === "translate"}
            onSelect={() => handleSelectTask("translate")}
            ariaLabel="Traduzir para inglês"
          >
            <div className="text-sm font-semibold text-text-1">Traduzir para inglês</div>
            <div className="mt-1 text-xs text-text-2">
              Gera o texto em inglês, mesmo que o áudio seja em outro idioma.
            </div>
          </PickTile>
        </PickTileGroup>
      </section>

      <section aria-label="Idioma do áudio">
        <SettingsSectionLabel>IDIOMA DO ÁUDIO</SettingsSectionLabel>
        <PickTileGroup className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PickTile
            selected={!hasSpecificLanguage}
            onSelect={handleAutoDetect}
            ariaLabel="Detectar automaticamente"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 shrink-0 rounded-lg border border-[rgba(91,156,255,0.28)] bg-[rgba(91,156,255,0.1)] text-accent-soft flex items-center justify-center">
                <Globe size={16} weight="regular" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-1">
                  Detectar automaticamente
                </div>
                <div className="mt-0.5 text-xs text-text-2">
                  A IA descobre o idioma sozinha.
                </div>
              </div>
            </div>
          </PickTile>

          <PickTile
            selected={hasSpecificLanguage}
            onSelect={handleChooseLanguageTile}
            ariaLabel="Escolher um idioma"
          >
            <div className="text-sm font-semibold text-text-1">Escolher um idioma</div>
            <div className="mt-0.5 text-xs text-text-2">
              Se você sabe qual é, a precisão melhora.
            </div>

            <div className="pointer-events-auto relative z-10 mt-3">
              <label htmlFor={languageSelectId} className="sr-only">
                Selecione o idioma
              </label>
              <div className="relative">
                <select
                  ref={selectRef}
                  id={languageSelectId}
                  value={activeLanguage}
                  onChange={(e) => handleSelectLanguage(e.target.value)}
                  className={FIELD_SELECT_CLASS}
                >
                  <option value="">Selecione o idioma</option>
                  {WHISPER_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
                <CaretDown
                  size={13}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                />
              </div>
            </div>
          </PickTile>
        </PickTileGroup>
      </section>

      <section aria-label="Mais usados">
        <SettingsSectionLabel>MAIS USADOS</SettingsSectionLabel>
        <div className="flex flex-wrap gap-2">
          {COMMON_LANGUAGES.map((item) => (
            <FormatChip
              key={item.code}
              label={item.label}
              selected={activeLanguage.toLowerCase() === item.code}
              onToggle={() => handleSelectLanguage(item.code)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tela 09 — Transcrição · Avançado (`whisper-advanced`)                      */
/* -------------------------------------------------------------------------- */

export function WhisperAdvancedSection({
  whisperConfig,
  whisperDevice,
  whisperFormats,
  onSaveWhisper,
  reporter,
}: WhisperSectionsProps) {
  const idPrefix = useId();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<WhisperConfig>>({});

  const [model, setModel] = useState<WhisperConfig["model"]>(
    (whisperConfig?.model as WhisperConfig["model"]) ?? "small",
  );
  const [device, setDevice] = useState<"cpu" | "cuda">(
    whisperConfig?.device ?? whisperDevice ?? "cuda",
  );
  const [formats, setFormats] = useState<string[]>(() => {
    if (Array.isArray(whisperConfig?.output_format) && whisperConfig!.output_format.length > 0) {
      return [...whisperConfig!.output_format];
    }
    return whisperFormats.length > 0 ? [...whisperFormats] : ["json", "vtt", "txt"];
  });

  // 1. Busca e amostragem (6)
  const [temperature, setTemperature] = useState<string>(
    cleanStr(whisperConfig?.temperature, "0"),
  );
  const [bestOf, setBestOf] = useState<string>(cleanStr(whisperConfig?.best_of, "5"));
  const [beamSize, setBeamSize] = useState<string>(cleanStr(whisperConfig?.beam_size, "5"));
  const [patience, setPatience] = useState<string>(cleanStr(whisperConfig?.patience));
  const [lengthPenalty, setLengthPenalty] = useState<string>(
    cleanStr(whisperConfig?.length_penalty),
  );
  const [verbose, setVerbose] = useState<boolean>(whisperConfig?.verbose ?? true);

  // 2. Token e prompt (4)
  const [suppressTokens, setSuppressTokens] = useState<string>(
    cleanStr(whisperConfig?.suppress_tokens, "-1"),
  );
  const [initialPrompt, setInitialPrompt] = useState<string>(
    cleanStr(whisperConfig?.initial_prompt),
  );
  const [carryInitialPrompt, setCarryInitialPrompt] = useState<boolean>(
    whisperConfig?.carry_initial_prompt ?? false,
  );
  const [conditionOnPreviousText, setConditionOnPreviousText] = useState<boolean>(
    whisperConfig?.condition_on_previous_text ?? true,
  );

  // 3. Decodificação avançada (5)
  const [fp16, setFp16] = useState<boolean>(whisperConfig?.fp16 ?? true);
  const [temperatureIncrement, setTemperatureIncrement] = useState<string>(
    cleanStr(whisperConfig?.temperature_increment_on_fallback, "0.2"),
  );
  const [compressionRatioThreshold, setCompressionRatioThreshold] = useState<string>(
    cleanStr(whisperConfig?.compression_ratio_threshold, "2.4"),
  );
  const [logprobThreshold, setLogprobThreshold] = useState<string>(
    cleanStr(whisperConfig?.logprob_threshold, "-1.0"),
  );
  const [noSpeechThreshold, setNoSpeechThreshold] = useState<string>(
    cleanStr(whisperConfig?.no_speech_threshold, "0.6"),
  );

  // 4. Timestamps e palavras (4)
  const [wordTimestamps, setWordTimestamps] = useState<boolean>(
    Boolean(whisperConfig?.word_timestamps),
  );
  const [prependPunctuations, setPrependPunctuations] = useState<string>(
    cleanStr(whisperConfig?.prepend_punctuations),
  );
  const [appendPunctuations, setAppendPunctuations] = useState<string>(
    cleanStr(whisperConfig?.append_punctuations),
  );
  const [highlightWords, setHighlightWords] = useState<boolean>(
    Boolean(whisperConfig?.highlight_words),
  );

  // 5. Formatação de saída (3)
  const [maxLineWidth, setMaxLineWidth] = useState<string>(
    cleanStr(whisperConfig?.max_line_width),
  );
  const [maxLineCount, setMaxLineCount] = useState<string>(
    cleanStr(whisperConfig?.max_line_count),
  );
  const [maxWordsPerLine, setMaxWordsPerLine] = useState<string>(
    cleanStr(whisperConfig?.max_words_per_line),
  );

  // 6. Performance (3)
  const [threads, setThreads] = useState<string>(cleanStr(whisperConfig?.threads, "0"));
  const [clipTimestamps, setClipTimestamps] = useState<string>(
    cleanStr(whisperConfig?.clip_timestamps, "0"),
  );
  const [hallucinationSilenceThreshold, setHallucinationSilenceThreshold] = useState<string>(
    cleanStr(whisperConfig?.hallucination_silence_threshold),
  );

  // Sync external changes when props update
  useEffect(() => {
    if (whisperConfig?.model) {
      setModel(whisperConfig.model);
    }
  }, [whisperConfig?.model]);

  useEffect(() => {
    setDevice(whisperConfig?.device ?? whisperDevice ?? "cuda");
  }, [whisperConfig?.device, whisperDevice]);

  useEffect(() => {
    if (Array.isArray(whisperConfig?.output_format) && whisperConfig!.output_format.length > 0) {
      setFormats([...whisperConfig!.output_format]);
    } else if (whisperFormats.length > 0) {
      setFormats([...whisperFormats]);
    }
  }, [whisperConfig?.output_format, whisperFormats]);

  const flushPendingSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (Object.keys(pendingPatchRef.current).length > 0) {
      const batch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      void persistWhisperPatch(onSaveWhisper, reporter, batch);
    }
  }, [onSaveWhisper, reporter]);

  const flushPendingSaveRef = useRef(flushPendingSave);
  flushPendingSaveRef.current = flushPendingSave;

  useEffect(() => {
    return () => {
      flushPendingSaveRef.current();
    };
  }, []);

  const saveImmediate = useCallback(
    (patch: Partial<WhisperConfig>) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const mergedPatch =
        Object.keys(pendingPatchRef.current).length > 0
          ? { ...pendingPatchRef.current, ...patch }
          : patch;
      pendingPatchRef.current = {};
      void persistWhisperPatch(onSaveWhisper, reporter, mergedPatch);
    },
    [onSaveWhisper, reporter],
  );

  const schedulePatch = useCallback(
    (partialPatch: Partial<WhisperConfig>) => {
      pendingPatchRef.current = {
        ...pendingPatchRef.current,
        ...partialPatch,
      };
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      reporter?.reportSaving();
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        flushPendingSaveRef.current();
      }, DEBOUNCE_MS);
    },
    [reporter],
  );

  const handleFormatToggle = (formatId: string) => {
    const isCurrentlySelected = formats.includes(formatId);
    const newFormats = isCurrentlySelected
      ? formats.filter((f) => f !== formatId)
      : [...formats, formatId];

    let resolved: string[];

    // Se "all" foi clicado e não estava marcado, marcar todos os outros
    if (newFormats.includes("all") && !formats.includes("all")) {
      resolved = ["all", "txt", "vtt", "srt", "tsv", "json"];
    }
    // Se "all" foi desmarcado, remover "all" e manter apenas os outros que foram marcados
    else if (!newFormats.includes("all") && formats.includes("all")) {
      const remaining = newFormats.filter((f) => f !== "all");
      if (remaining.length === 0) {
        return;
      }
      resolved = remaining;
    }
    // Se qualquer outro foi clicado
    else if (!newFormats.includes("all")) {
      // Se ficou vazio, não permitir (manter pelo menos um)
      if (newFormats.length === 0) {
        return;
      }
      // Se foram marcados todos os outros, marcar "all" também
      if (INDIVIDUAL_FORMAT_IDS.every((f) => newFormats.includes(f))) {
        resolved = [...newFormats, "all"];
      } else {
        resolved = newFormats;
      }
    } else {
      // "all" estava marcado mas o usuário desmarcou um formato individual
      const withoutAll = newFormats.filter((f) => f !== "all");
      if (!INDIVIDUAL_FORMAT_IDS.every((f) => withoutAll.includes(f))) {
        if (withoutAll.length === 0) {
          return;
        }
        resolved = withoutAll;
      } else {
        resolved = newFormats;
      }
    }

    setFormats(resolved);
    saveImmediate({ output_format: resolved as WhisperConfig["output_format"] });
  };

  const currentConfig = useMemo<Partial<WhisperConfig>>(
    () => ({
      ...whisperConfig,
      model,
      device,
      model_dir: cleanStr(whisperConfig?.model_dir) || undefined,
      output_dir: cleanStr(whisperConfig?.output_dir) || undefined,
      output_format: formats as WhisperConfig["output_format"],
      verbose,
      task: whisperConfig?.task ?? "transcribe",
      language: cleanStr(whisperConfig?.language) || undefined,
      temperature: cleanStr(temperature) || undefined,
      best_of: cleanStr(bestOf) || undefined,
      beam_size: cleanStr(beamSize) || undefined,
      patience: parseOptionalFloat(patience),
      length_penalty: parseOptionalFloat(lengthPenalty),
      suppress_tokens: cleanStr(suppressTokens) || undefined,
      initial_prompt: cleanStr(initialPrompt) || undefined,
      carry_initial_prompt: carryInitialPrompt,
      condition_on_previous_text: conditionOnPreviousText,
      fp16,
      temperature_increment_on_fallback: cleanStr(temperatureIncrement) || undefined,
      compression_ratio_threshold: cleanStr(compressionRatioThreshold) || undefined,
      logprob_threshold: cleanStr(logprobThreshold) || undefined,
      no_speech_threshold: cleanStr(noSpeechThreshold) || undefined,
      word_timestamps: wordTimestamps,
      prepend_punctuations: cleanStr(prependPunctuations) || undefined,
      append_punctuations: cleanStr(appendPunctuations) || undefined,
      highlight_words: highlightWords,
      max_line_width: parseOptionalInt(maxLineWidth),
      max_line_count: parseOptionalInt(maxLineCount),
      max_words_per_line: parseOptionalInt(maxWordsPerLine),
      threads: cleanStr(threads) || undefined,
      clip_timestamps: cleanStr(clipTimestamps) || undefined,
      hallucination_silence_threshold: parseOptionalFloat(hallucinationSilenceThreshold),
    }),
    [
      whisperConfig,
      model,
      device,
      formats,
      verbose,
      temperature,
      bestOf,
      beamSize,
      patience,
      lengthPenalty,
      suppressTokens,
      initialPrompt,
      carryInitialPrompt,
      conditionOnPreviousText,
      fp16,
      temperatureIncrement,
      compressionRatioThreshold,
      logprobThreshold,
      noSpeechThreshold,
      wordTimestamps,
      prependPunctuations,
      appendPunctuations,
      highlightWords,
      maxLineWidth,
      maxLineCount,
      maxWordsPerLine,
      threads,
      clipTimestamps,
      hallucinationSilenceThreshold,
    ],
  );

  const whisperCommand = useMemo(
    () => generateWhisperCommand(currentConfig, ".\\Nome_Do_Seu_Video"),
    [currentConfig],
  );

  return (
    <div className="space-y-5">
      {/* Formatos de saída */}
      <section aria-label="Formatos de saída">
        <SettingsSectionLabel>FORMATOS DE SAÍDA</SettingsSectionLabel>
        <div className="flex flex-wrap gap-2">
          {WHISPER_OUTPUT_FORMATS.map((fmt) => {
            const isSelected =
              formats.includes(fmt.id) || (fmt.id !== "all" && formats.includes("all"));
            return (
              <FormatChip
                key={fmt.id}
                label={fmt.label}
                selected={isSelected}
                onToggle={() => handleFormatToggle(fmt.id)}
              />
            );
          })}
        </div>
      </section>

      {/* Modelo e Dispositivo */}
      <section aria-label="Modelo">
        <SettingsSectionLabel>MODELO</SettingsSectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={`${idPrefix}-model`}
              className="block text-xs text-text-2 mb-1.5"
            >
              Modelo Whisper
            </label>
            <div className="relative">
              <select
                id={`${idPrefix}-model`}
                value={model}
                onChange={(e) => {
                  const next = e.target.value as WhisperConfig["model"];
                  setModel(next);
                  saveImmediate({ model: next });
                }}
                className={FIELD_SELECT_CLASS}
              >
                {WHISPER_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.size}
                  </option>
                ))}
              </select>
              <CaretDown
                size={13}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor={`${idPrefix}-device`}
              className="block text-xs text-text-2 mb-1.5"
            >
              Dispositivo
            </label>
            <div className="relative">
              <select
                id={`${idPrefix}-device`}
                value={device}
                onChange={(e) => {
                  const next = e.target.value as "cpu" | "cuda";
                  setDevice(next);
                  saveImmediate({ device: next });
                }}
                className={FIELD_SELECT_CLASS}
              >
                <option value="cuda">CUDA (GPU NVIDIA)</option>
                <option value="cpu">CPU (Processador)</option>
              </select>
              <CaretDown
                size={13}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Opções do Whisper — 6 grupos nativos <details> + <summary> */}
      <section aria-label="Opções do Whisper">
        <SettingsSectionLabel>OPÇÕES DO WHISPER</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-white/[0.015] divide-y divide-line overflow-hidden">
          {/* 1. Busca e amostragem (6) */}
          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Busca e amostragem</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">6</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-temperature`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Temperatura
                </label>
                <input
                  id={`${idPrefix}-temperature`}
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={temperature}
                  placeholder="0"
                  onChange={(e) => {
                    const val = e.target.value;
                    setTemperature(val);
                    schedulePatch({ temperature: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-best-of`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Best of
                </label>
                <input
                  id={`${idPrefix}-best-of`}
                  type="number"
                  min={1}
                  value={bestOf}
                  placeholder="5"
                  onChange={(e) => {
                    const val = e.target.value;
                    setBestOf(val);
                    schedulePatch({ best_of: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-beam-size`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Tamanho do beam
                </label>
                <input
                  id={`${idPrefix}-beam-size`}
                  type="number"
                  min={1}
                  value={beamSize}
                  placeholder="5"
                  onChange={(e) => {
                    const val = e.target.value;
                    setBeamSize(val);
                    schedulePatch({ beam_size: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-patience`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Patience
                </label>
                <input
                  id={`${idPrefix}-patience`}
                  type="number"
                  min={0.1}
                  step="0.1"
                  value={patience}
                  placeholder="Padrão"
                  onChange={(e) => {
                    const val = e.target.value;
                    setPatience(val);
                    schedulePatch({ patience: parseOptionalFloat(val) });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-length-penalty`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Penalidade de comprimento
                </label>
                <input
                  id={`${idPrefix}-length-penalty`}
                  type="number"
                  step="0.1"
                  value={lengthPenalty}
                  placeholder="Padrão"
                  onChange={(e) => {
                    const val = e.target.value;
                    setLengthPenalty(val);
                    schedulePatch({ length_penalty: parseOptionalFloat(val) });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-verbose`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Modo verbose
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-verbose`}
                    value={verbose ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setVerbose(next);
                      saveImmediate({ verbose: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="true">Ligado</option>
                    <option value="false">Desligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* 2. Token e prompt (4) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Token e prompt</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">4</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-suppress-tokens`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Suprimir tokens
                </label>
                <input
                  id={`${idPrefix}-suppress-tokens`}
                  type="text"
                  value={suppressTokens}
                  placeholder="-1"
                  onChange={(e) => {
                    const val = e.target.value;
                    setSuppressTokens(val);
                    schedulePatch({ suppress_tokens: val || undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-initial-prompt`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Prompt inicial
                </label>
                <input
                  id={`${idPrefix}-initial-prompt`}
                  type="text"
                  value={initialPrompt}
                  placeholder="(opcional)"
                  onChange={(e) => {
                    const val = e.target.value;
                    setInitialPrompt(val);
                    schedulePatch({ initial_prompt: val || undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-carry-initial-prompt`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Manter prompt inicial
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-carry-initial-prompt`}
                    value={carryInitialPrompt ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setCarryInitialPrompt(next);
                      saveImmediate({ carry_initial_prompt: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="false">Desligado</option>
                    <option value="true">Ligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-condition-prev-text`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Condicionar em texto anterior
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-condition-prev-text`}
                    value={conditionOnPreviousText ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setConditionOnPreviousText(next);
                      saveImmediate({ condition_on_previous_text: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="true">Ligado</option>
                    <option value="false">Desligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* 3. Decodificação avançada (5) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Decodificação avançada</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">5</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-fp16`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  FP16
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-fp16`}
                    value={fp16 ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setFp16(next);
                      saveImmediate({ fp16: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="true">Ligado</option>
                    <option value="false">Desligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-temp-inc`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Incremento de temperatura
                </label>
                <input
                  id={`${idPrefix}-temp-inc`}
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={temperatureIncrement}
                  placeholder="0.2"
                  onChange={(e) => {
                    const val = e.target.value;
                    setTemperatureIncrement(val);
                    schedulePatch({
                      temperature_increment_on_fallback: val !== "" ? val : undefined,
                    });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-compression-ratio`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Limiar de compressão gzip
                </label>
                <input
                  id={`${idPrefix}-compression-ratio`}
                  type="number"
                  min={1}
                  step="0.1"
                  value={compressionRatioThreshold}
                  placeholder="2.4"
                  onChange={(e) => {
                    const val = e.target.value;
                    setCompressionRatioThreshold(val);
                    schedulePatch({
                      compression_ratio_threshold: val !== "" ? val : undefined,
                    });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-logprob`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Limiar de logprob
                </label>
                <input
                  id={`${idPrefix}-logprob`}
                  type="number"
                  step="0.1"
                  value={logprobThreshold}
                  placeholder="-1.0"
                  onChange={(e) => {
                    const val = e.target.value;
                    setLogprobThreshold(val);
                    schedulePatch({ logprob_threshold: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-no-speech`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Limiar sem fala
                </label>
                <input
                  id={`${idPrefix}-no-speech`}
                  type="number"
                  min={0}
                  max={1}
                  step="0.1"
                  value={noSpeechThreshold}
                  placeholder="0.6"
                  onChange={(e) => {
                    const val = e.target.value;
                    setNoSpeechThreshold(val);
                    schedulePatch({ no_speech_threshold: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </div>
          </details>

          {/* 4. Timestamps e palavras (4) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Timestamps e palavras</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">4</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-word-timestamps`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Timestamps de palavras
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-word-timestamps`}
                    value={wordTimestamps ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setWordTimestamps(next);
                      saveImmediate({ word_timestamps: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="false">Desligado</option>
                    <option value="true">Ligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-highlight-words`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Destacar palavras
                </label>
                <div className="relative">
                  <select
                    id={`${idPrefix}-highlight-words`}
                    value={highlightWords ? "true" : "false"}
                    onChange={(e) => {
                      const next = e.target.value === "true";
                      setHighlightWords(next);
                      saveImmediate({ highlight_words: next });
                    }}
                    className={FIELD_SELECT_CLASS}
                  >
                    <option value="false">Desligado</option>
                    <option value="true">Ligado</option>
                  </select>
                  <CaretDown
                    size={13}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-prepend-punct`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Pontuações prepend
                </label>
                <input
                  id={`${idPrefix}-prepend-punct`}
                  type="text"
                  value={prependPunctuations}
                  placeholder={`"'¿([{-`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPrependPunctuations(val);
                    schedulePatch({ prepend_punctuations: val || undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-append-punct`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Pontuações append
                </label>
                <input
                  id={`${idPrefix}-append-punct`}
                  type="text"
                  value={appendPunctuations}
                  placeholder={`"'.。,，!！?？:：")]}、`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAppendPunctuations(val);
                    schedulePatch({ append_punctuations: val || undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </div>
          </details>

          {/* 5. Formatação de saída (3) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Formatação de saída</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">3</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-max-line-width`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Largura máxima de linha
                </label>
                <input
                  id={`${idPrefix}-max-line-width`}
                  type="number"
                  min={20}
                  value={maxLineWidth}
                  placeholder="Sem limite"
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxLineWidth(val);
                    schedulePatch({ max_line_width: parseOptionalInt(val) });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-max-line-count`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Máximo de linhas
                </label>
                <input
                  id={`${idPrefix}-max-line-count`}
                  type="number"
                  min={1}
                  value={maxLineCount}
                  placeholder="Sem limite"
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxLineCount(val);
                    schedulePatch({ max_line_count: parseOptionalInt(val) });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-max-words-per-line`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Máximo de palavras por linha
                </label>
                <input
                  id={`${idPrefix}-max-words-per-line`}
                  type="number"
                  min={1}
                  value={maxWordsPerLine}
                  placeholder="Sem limite"
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxWordsPerLine(val);
                    schedulePatch({ max_words_per_line: parseOptionalInt(val) });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </div>
          </details>

          {/* 6. Performance (3) */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-text-1 select-none hover:bg-glass-hover transition-colors duration-fast [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2.5">
                <CaretRight
                  size={13}
                  className="text-text-3 transition-transform duration-fast group-open:rotate-90"
                />
                <span>Performance</span>
              </span>
              <span className="text-xs text-text-3 tabular-nums">3</span>
            </summary>

            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor={`${idPrefix}-threads`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Threads
                </label>
                <input
                  id={`${idPrefix}-threads`}
                  type="number"
                  min={0}
                  value={threads}
                  placeholder="0"
                  onChange={(e) => {
                    const val = e.target.value;
                    setThreads(val);
                    schedulePatch({ threads: val !== "" ? val : undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-clip-timestamps`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Corte de timestamps
                </label>
                <input
                  id={`${idPrefix}-clip-timestamps`}
                  type="text"
                  value={clipTimestamps}
                  placeholder="0"
                  onChange={(e) => {
                    const val = e.target.value;
                    setClipTimestamps(val);
                    schedulePatch({ clip_timestamps: val || undefined });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>

              <div>
                <label
                  htmlFor={`${idPrefix}-hallucination-silence`}
                  className="block text-xs text-text-2 mb-1.5"
                >
                  Limiar de alucinação-silêncio
                </label>
                <input
                  id={`${idPrefix}-hallucination-silence`}
                  type="number"
                  min={0}
                  step="0.1"
                  value={hallucinationSilenceThreshold}
                  placeholder="(opcional)"
                  onChange={(e) => {
                    const val = e.target.value;
                    setHallucinationSilenceThreshold(val);
                    schedulePatch({
                      hallucination_silence_threshold: parseOptionalFloat(val),
                    });
                  }}
                  onBlur={flushPendingSave}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </div>
          </details>
        </div>
      </section>

      {/* Prévia do comando */}
      <section aria-label="Prévia do comando">
        <SettingsSectionLabel>PRÉVIA DO COMANDO</SettingsSectionLabel>
        <div className="rounded-card border border-line bg-white/[0.02] px-3.5 py-2.5 font-sans text-xs tabular-nums text-text-2 overflow-x-auto whitespace-nowrap">
          {whisperCommand}
        </div>
      </section>
    </div>
  );
}
