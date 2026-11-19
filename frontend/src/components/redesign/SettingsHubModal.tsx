import {
  CaretDown,
  CaretRight,
  Cpu,
  FilmStrip,
  Gear,
  ListChecks,
  Microphone,
  Question,
  Sparkle,
  Stamp,
  X,
} from "@phosphor-icons/react";
import type { BatchPipelineOptions } from "@youtube-shorts/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FFmpegConfig } from "../../types/ffmpeg";
import type { WhisperConfig } from "../../types/whisper";
import type { UseWatermarkResult } from "../../hooks/useWatermark";
import {
  AIInstructionsSection,
  AIModelSection,
  AISearchSection,
  type LLMAutoSavePatch,
  type OllamaModelCatalogItem,
} from "./settings/AISections";
import {
  AppDownloadSection,
  AppFoldersSection,
  DependenciesSection,
  type DependenciesSectionProps,
  type DependencyStatus,
} from "./settings/AppAndDepsSections";
import {
  BatchSection,
  FFmpegAdvancedSection,
  FFmpegAudioSection,
  FFmpegQualitySection,
  FFmpegVisualSection,
  HowToUseSection,
  type BatchSectionVideoItem,
} from "./settings/FFmpegAndUtilitySections";
import {
  getSectionMeta,
  RESTORABLE_SECTIONS,
  RestoreDefaultsButton,
  SETTINGS_FOOTER_GROUP_ID,
  SETTINGS_NAV_GROUPS,
  type AppSettingsPatch,
  type AutoSaveReporter,
  type DownloadResolution,
  type NavIconName,
  type PendingRestoreMap,
  type RestoreScope,
  type SaveStatus,
  type SectionId,
} from "./settings/settingsShared";
import { WatermarkSection } from "./settings/WatermarkSection";
import {
  TranscriptDisplaySection,
  WhisperAdvancedSection,
  WhisperLanguageSection,
  WhisperModelSection,
} from "./settings/WhisperSections";

export interface SettingsHubModalProps {
  open: boolean;
  initialSection?: SectionId;
  onClose: () => void;
  suppressEscape?: boolean;
  onSectionEnter?: (section: SectionId) => void;

  // Aplicação (Telas 01–02)
  baseDir: string;
  downloadResolution: DownloadResolution;
  askDeleteCutConfirm: boolean;
  onSaveAppSettings: (patch: AppSettingsPatch) => void | Promise<void>;

  // Dependências (Tela 03)
  dependencies: Record<string, DependencyStatus> | null;
  loadingDependencies: Set<string>;
  installingDependency: string | null;
  uninstallingDependency: string | null;
  dependencyOperationMessage: string | null;
  dependencyOperationTone: "success" | "warning" | "error";
  installSessionId: string | null;
  installLogOperation: "install" | "uninstall" | null;
  installLogDependency: string | null;
  installLogStatus: "idle" | "running" | "success" | "failed" | "cancelled";
  installLogs: string[];
  showInstallLogs: boolean;
  refreshingDependencies: boolean;
  onRefreshDependencies: () => Promise<void>;
  onShowInstallInstructions: (name: string) => void;
  onInstallDependency: DependenciesSectionProps["onInstallDependency"];
  onUninstallDependency: DependenciesSectionProps["onUninstallDependency"];
  onCancelInstallSession: (sessionId: string) => Promise<void>;
  onDownloadInstallLogs: () => void;

  // IA e Modelos (Telas 04–06)
  llmModel: string;
  embeddingModel: string;
  registeredEmbeddingModels: string[];
  availableModels: string[];
  modelCatalog: OllamaModelCatalogItem[];
  llmSystemPrompt: string;
  onSaveLLM: (patch: LLMAutoSavePatch) => Promise<void> | void;
  onRegisterModel: (
    name: string,
    source: "cloud" | "local",
  ) => Promise<{
    success: boolean;
    message: string;
    model: { name: string; source: "cloud" | "local" };
  }>;
  onRemoveModel: (name: string) => Promise<{ success: boolean; message: string }>;
  onRefreshModels: () => Promise<void>;

  // Transcrição / Whisper (Telas 07–09)
  whisperConfig: Partial<WhisperConfig> | null;
  whisperDevice: "cpu" | "cuda";
  whisperFormats: string[];
  onSaveWhisper: (patch: Partial<WhisperConfig>) => Promise<void> | void;
  transcriptFontSize: number;
  onChangeTranscriptFontSize: (px: number) => void;
  transcriptBlackOverVideoBg: boolean;
  onChangeTranscriptBlackOverVideoBg: (enabled: boolean) => void;
  transcriptBlackOverVideoOpacity: number;
  onChangeTranscriptBlackOverVideoOpacity: (opacityPct: number) => void;

  // Renderização / FFmpeg (Telas 10–12)
  ffmpegConfig: FFmpegConfig | null;
  onSaveFFmpeg: (config: FFmpegConfig) => Promise<void> | void;

  // Marca d'água
  watermark: UseWatermarkResult;

  // Processar em lote (Tela 13)
  videos: BatchSectionVideoItem[];
  selectedVideosForBatch: string[];
  batchPipelineOptions: BatchPipelineOptions;
  isBatchProcessing: boolean;
  activeBatchId?: string | null;
  onBatchVideoToggle: (videoId: string) => void;
  onBatchOptionChange: (options: Partial<BatchPipelineOptions>) => void;
  onCancelBatch: () => Promise<void> | void;
  onStartBatch: () => Promise<void> | void;

  // Restauração para padrões de fábrica
  pendingRestores?: PendingRestoreMap;
  onStartRestore?: (scope: RestoreScope) => void;
  onCancelRestore?: (scope: RestoreScope) => void;
}

const noopRestore = () => {};

function renderNavIcon(icon: NavIconName, active: boolean) {
  const className = active ? "text-accent-soft shrink-0" : "text-text-2 shrink-0";
  switch (icon) {
    case "gear":
      return <Gear size={16} weight="regular" className={className} />;
    case "cpu":
      return <Cpu size={16} weight="regular" className={className} />;
    case "sparkle":
      return <Sparkle size={16} weight="regular" className={className} />;
    case "microphone":
      return <Microphone size={16} weight="regular" className={className} />;
    case "film":
      return <FilmStrip size={16} weight="regular" className={className} />;
    case "stamp":
      return <Stamp size={16} weight="regular" className={className} />;
  }
}

export function SettingsHubModal({
  open,
  initialSection = "app-folders",
  onClose,
  suppressEscape = false,
  onSectionEnter,
  baseDir,
  downloadResolution,
  askDeleteCutConfirm,
  onSaveAppSettings,
  dependencies,
  loadingDependencies,
  installingDependency,
  uninstallingDependency,
  dependencyOperationMessage,
  dependencyOperationTone,
  installSessionId,
  installLogOperation,
  installLogDependency,
  installLogStatus,
  installLogs,
  showInstallLogs,
  refreshingDependencies,
  onRefreshDependencies,
  onShowInstallInstructions,
  onInstallDependency,
  onUninstallDependency,
  onCancelInstallSession,
  onDownloadInstallLogs,
  llmModel,
  embeddingModel,
  registeredEmbeddingModels,
  availableModels,
  modelCatalog,
  llmSystemPrompt,
  onSaveLLM,
  onRegisterModel,
  onRemoveModel,
  onRefreshModels,
  whisperConfig,
  whisperDevice,
  whisperFormats,
  onSaveWhisper,
  transcriptFontSize,
  onChangeTranscriptFontSize,
  transcriptBlackOverVideoBg,
  onChangeTranscriptBlackOverVideoBg,
  transcriptBlackOverVideoOpacity,
  onChangeTranscriptBlackOverVideoOpacity,
  ffmpegConfig,
  onSaveFFmpeg,
  watermark,
  videos,
  selectedVideosForBatch,
  batchPipelineOptions,
  isBatchProcessing,
  activeBatchId,
  onBatchVideoToggle,
  onBatchOptionChange,
  onCancelBatch,
  onStartBatch,
  pendingRestores,
  onStartRestore,
  onCancelRestore,
}: SettingsHubModalProps) {
  const [activeSection, setActiveSection] = useState<SectionId>(initialSection);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const meta = getSectionMeta(initialSection);
    return meta.groupId !== SETTINGS_FOOTER_GROUP_ID ? { [meta.groupId]: true } : {};
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Sincroniza seção inicial e grupos expandidos ao abrir ou mudar initialSection
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    const meta = getSectionMeta(initialSection);
    setActiveSection(initialSection);
    setSaveStatus("idle");
    setSaveError(null);

    if (!wasOpenRef.current) {
      setExpandedGroups(
        meta.groupId !== SETTINGS_FOOTER_GROUP_ID ? { [meta.groupId]: true } : {},
      );
    } else if (meta.groupId !== SETTINGS_FOOTER_GROUP_ID) {
      setExpandedGroups((prev) =>
        prev[meta.groupId] ? prev : { ...prev, [meta.groupId]: true },
      );
    }

    wasOpenRef.current = true;
  }, [open, initialSection]);

  // Reseta o scroll do conteúdo ao trocar de seção
  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [open, activeSection]);

  // Fecha com Escape (respeitando submodais abertos por cima, ex.: instruções)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !suppressEscape) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, suppressEscape, onClose]);

  const reporter = useMemo<AutoSaveReporter>(
    () => ({
      reportSaving: () => {
        setSaveStatus("saving");
        setSaveError(null);
      },
      reportSaved: () => {
        setSaveStatus("saved");
        setSaveError(null);
      },
      reportError: (msg?: string) => {
        setSaveStatus("error");
        setSaveError(msg || "Erro ao salvar");
      },
    }),
    [],
  );

  const navigateToSection = useCallback(
    (nextSection: SectionId) => {
      const nextMeta = getSectionMeta(nextSection);
      if (nextMeta.groupId !== SETTINGS_FOOTER_GROUP_ID) {
        setExpandedGroups((prev) =>
          prev[nextMeta.groupId] ? prev : { ...prev, [nextMeta.groupId]: true },
        );
      }
      setSaveStatus("idle");
      setSaveError(null);
      setActiveSection(nextSection);
      onSectionEnter?.(nextSection);
    },
    [onSectionEnter],
  );

  const handleGroupClick = (groupId: string, firstChildId: SectionId, isActiveGroup: boolean) => {
    const isExpanded = Boolean(expandedGroups[groupId]);
    if (isExpanded) {
      setExpandedGroups((prev) => ({ ...prev, [groupId]: false }));
      return;
    }

    setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
    if (!isActiveGroup) {
      navigateToSection(firstChildId);
    }
  };

  const meta = getSectionMeta(activeSection);

  const handleSidebarKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.dataset.settingsNavItem !== "true") return;

    const sidebarEl = sidebarRef.current;
    if (!sidebarEl) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(
        sidebarEl.querySelectorAll<HTMLButtonElement>('button[data-settings-nav-item="true"]'),
      );
      const currentIndex = items.indexOf(target as HTMLButtonElement);
      if (currentIndex === -1 || items.length === 0) return;
      const nextIndex =
        e.key === "ArrowDown"
          ? (currentIndex + 1) % items.length
          : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex]?.focus();
      return;
    }

    const groupId = target.dataset.settingsGroupId;
    const isGroupHeader = target.dataset.settingsGroupHeader === "true";

    if (e.key === "ArrowRight" && isGroupHeader && groupId) {
      e.preventDefault();
      const group = SETTINGS_NAV_GROUPS.find((g) => g.id === groupId);
      if (!group?.children?.length) return;
      if (!expandedGroups[groupId]) {
        setExpandedGroups((prev) => ({ ...prev, [groupId]: true }));
        const isActiveGroup = meta.groupId === groupId;
        if (!isActiveGroup) {
          navigateToSection(group.children[0].id);
        }
      } else {
        const firstChild = sidebarEl.querySelector<HTMLButtonElement>(
          `button[data-settings-child-of="${groupId}"]`,
        );
        firstChild?.focus();
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      const childOf = target.dataset.settingsChildOf;
      if (isGroupHeader && groupId && expandedGroups[groupId]) {
        e.preventDefault();
        setExpandedGroups((prev) => ({ ...prev, [groupId]: false }));
      } else if (childOf) {
        e.preventDefault();
        const parentBtn = sidebarEl.querySelector<HTMLButtonElement>(
          `button[data-settings-group-header="true"][data-settings-group-id="${childOf}"]`,
        );
        parentBtn?.focus();
      }
    }
  };

  if (!open) return null;

  const renderSection = () => {
    switch (activeSection) {
      case "app-folders":
        return (
          <AppFoldersSection
            baseDir={baseDir}
            askDeleteCutConfirm={askDeleteCutConfirm}
            onSaveAppSettings={onSaveAppSettings}
            reporter={reporter}
          />
        );
      case "app-download":
        return (
          <AppDownloadSection
            downloadResolution={downloadResolution}
            onSaveAppSettings={onSaveAppSettings}
            reporter={reporter}
          />
        );
      case "dependencies":
        return (
          <DependenciesSection
            dependencies={dependencies}
            loadingDependencies={loadingDependencies}
            installingDependency={installingDependency}
            uninstallingDependency={uninstallingDependency}
            operationResultMessage={dependencyOperationMessage}
            operationResultTone={dependencyOperationTone}
            installSessionId={installSessionId}
            installLogOperation={installLogOperation}
            installLogDependency={installLogDependency}
            installLogStatus={installLogStatus}
            installLogs={installLogs}
            showInstallLogs={showInstallLogs}
            refreshingDependencies={refreshingDependencies}
            onRefresh={onRefreshDependencies}
            onShowInstallInstructions={onShowInstallInstructions}
            onInstallDependency={onInstallDependency}
            onUninstallDependency={onUninstallDependency}
            onCancelInstallSession={onCancelInstallSession}
            onDownloadInstallLogs={onDownloadInstallLogs}
          />
        );
      case "ai-model":
        return (
          <AIModelSection
            llmModel={llmModel}
            embeddingModel={embeddingModel}
            availableModels={availableModels}
            modelCatalog={modelCatalog}
            onSaveLLM={onSaveLLM}
            onRegisterModel={onRegisterModel}
            onRemoveModel={onRemoveModel}
            onRefreshModels={onRefreshModels}
            onNavigateSection={navigateToSection}
            reporter={reporter}
          />
        );
      case "ai-search":
        return (
          <AISearchSection
            embeddingModel={embeddingModel}
            registeredEmbeddingModels={registeredEmbeddingModels}
            modelCatalog={modelCatalog}
            onSaveLLM={onSaveLLM}
            onRegisterModel={onRegisterModel}
            onRefreshModels={onRefreshModels}
            reporter={reporter}
          />
        );
      case "ai-instructions":
        return (
          <AIInstructionsSection
            llmSystemPrompt={llmSystemPrompt}
            onSaveLLM={onSaveLLM}
            reporter={reporter}
          />
        );
      case "whisper-model":
        return (
          <WhisperModelSection
            whisperConfig={whisperConfig}
            whisperDevice={whisperDevice}
            whisperFormats={whisperFormats}
            onSaveWhisper={onSaveWhisper}
            reporter={reporter}
          />
        );
      case "whisper-language":
        return (
          <WhisperLanguageSection
            whisperConfig={whisperConfig}
            whisperDevice={whisperDevice}
            whisperFormats={whisperFormats}
            onSaveWhisper={onSaveWhisper}
            reporter={reporter}
          />
        );
      case "whisper-advanced":
        return (
          <WhisperAdvancedSection
            whisperConfig={whisperConfig}
            whisperDevice={whisperDevice}
            whisperFormats={whisperFormats}
            onSaveWhisper={onSaveWhisper}
            reporter={reporter}
          />
        );
      case "transcript-display":
        return (
          <TranscriptDisplaySection
            fontSizePx={transcriptFontSize}
            blackOverVideoBg={transcriptBlackOverVideoBg}
            blackOverVideoOpacity={transcriptBlackOverVideoOpacity}
            onChangeFontSize={onChangeTranscriptFontSize}
            onChangeBlackOverVideoBg={onChangeTranscriptBlackOverVideoBg}
            onChangeBlackOverVideoOpacity={onChangeTranscriptBlackOverVideoOpacity}
            reporter={reporter}
          />
        );
      case "ffmpeg-quality":
        return (
          <FFmpegQualitySection
            ffmpegConfig={ffmpegConfig}
            onSaveFFmpeg={onSaveFFmpeg}
            reporter={reporter}
          />
        );
      case "ffmpeg-visual":
        return (
          <FFmpegVisualSection
            ffmpegConfig={ffmpegConfig}
            onSaveFFmpeg={onSaveFFmpeg}
            reporter={reporter}
          />
        );
      case "ffmpeg-audio":
        return (
          <FFmpegAudioSection
            ffmpegConfig={ffmpegConfig}
            onSaveFFmpeg={onSaveFFmpeg}
            reporter={reporter}
          />
        );
      case "ffmpeg-advanced":
        return (
          <FFmpegAdvancedSection
            ffmpegConfig={ffmpegConfig}
            onSaveFFmpeg={onSaveFFmpeg}
            reporter={reporter}
          />
        );
      case "watermark":
        return <WatermarkSection watermark={watermark} reporter={reporter} />;
      case "batch":
        return (
          <BatchSection
            videos={videos}
            selectedVideosForBatch={selectedVideosForBatch}
            batchPipelineOptions={batchPipelineOptions}
            isBatchProcessing={isBatchProcessing}
            activeBatchId={activeBatchId}
            onClose={onClose}
            onVideoToggle={onBatchVideoToggle}
            onOptionChange={onBatchOptionChange}
            onCancel={onCancelBatch}
            onStart={onStartBatch}
          />
        );
      case "how-to-use":
        return <HowToUseSection />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configurações"
        className="w-[min(1120px,calc(100vw-32px))] h-[min(680px,calc(100vh-32px))] rounded-[14px] bg-[#101216]/[0.98] border border-line-strong shadow-panel flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar esquerda em árvore */}
        <aside
          ref={sidebarRef}
          onKeyDown={handleSidebarKeyDown}
          className="w-[240px] sm:w-[260px] shrink-0 border-r border-line flex flex-col p-4 bg-white/[0.01]"
        >
          <h2 className="text-md font-semibold text-text-1 px-2.5 pt-1 pb-3">Configurações</h2>

          <nav
            aria-label="Seções de configurações"
            className="flex-1 min-h-0 overflow-y-auto arc-scroll space-y-0.5 pr-3 -mr-1"
          >
            {SETTINGS_NAV_GROUPS.map((group) => {
              const hasChildren = Boolean(group.children?.length);
              const isExpanded = Boolean(expandedGroups[group.id]);
              const isGroupActive = meta.groupId === group.id;

              if (!hasChildren && group.leafId) {
                const isLeafActive = activeSection === group.leafId;
                return (
                  <button
                    key={group.id}
                    type="button"
                    data-settings-nav-item="true"
                    aria-current={isLeafActive ? "page" : undefined}
                    onClick={() => navigateToSection(group.leafId!)}
                    className={[
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item text-sm text-left transition-colors duration-fast",
                      isLeafActive
                        ? "bg-glass-active text-text-1 font-medium"
                        : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                    ].join(" ")}
                  >
                    {renderNavIcon(group.icon, isLeafActive)}
                    <span className="truncate">{group.label}</span>
                  </button>
                );
              }

              const firstChildId = group.children![0].id;

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    data-settings-nav-item="true"
                    data-settings-group-header="true"
                    data-settings-group-id={group.id}
                    aria-expanded={isExpanded}
                    onClick={() => handleGroupClick(group.id, firstChildId, isGroupActive)}
                    className={[
                      "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-item text-sm text-left transition-colors duration-fast",
                      isGroupActive
                        ? "text-text-1"
                        : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {renderNavIcon(group.icon, isGroupActive)}
                      <span className="truncate">{group.label}</span>
                    </span>
                    <span className="text-text-3 shrink-0" aria-hidden="true">
                      {isExpanded ? <CaretDown size={13} /> : <CaretRight size={13} />}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="ml-4 pl-2.5 border-l border-line space-y-0.5 mt-0.5">
                      {group.children!.map((child) => {
                        const isChildActive = activeSection === child.id;
                        return (
                          <button
                            key={child.id}
                            type="button"
                            data-settings-nav-item="true"
                            data-settings-child-of={group.id}
                            aria-current={isChildActive ? "page" : undefined}
                            onClick={() => navigateToSection(child.id)}
                            className={[
                              "w-full flex items-center px-2.5 py-1.5 rounded-item text-sm text-left transition-colors duration-fast",
                              isChildActive
                                ? "bg-glass-active text-text-1 font-medium"
                                : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
                            ].join(" ")}
                          >
                            <span className="truncate">{child.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Ações fixas no rodapé da barra lateral */}
          <div className="mt-auto pt-3 border-t border-line space-y-0.5">
            <button
              type="button"
              data-settings-nav-item="true"
              aria-current={activeSection === "batch" ? "page" : undefined}
              onClick={() => navigateToSection("batch")}
              className={[
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item text-sm text-left transition-colors duration-fast",
                activeSection === "batch"
                  ? "bg-glass-active text-text-1 font-medium"
                  : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
              ].join(" ")}
            >
              <ListChecks
                size={16}
                weight="regular"
                className={activeSection === "batch" ? "text-accent-soft shrink-0" : "text-text-2 shrink-0"}
              />
              <span className="truncate">Processar em lote</span>
            </button>

            <RestoreDefaultsButton
              scope="all"
              label="Restaurar padrões"
              confirmTitle="Restaurar configurações para os padrões iniciais?"
              confirmDescription="Pastas, modelos de IA, transcrição e renderização voltarão aos valores de fábrica."
              pending={pendingRestores?.all}
              onConfirmStart={onStartRestore ?? noopRestore}
              onCancelPending={onCancelRestore ?? noopRestore}
              variant="sidebar"
            />

            <button
              type="button"
              data-settings-nav-item="true"
              aria-current={activeSection === "how-to-use" ? "page" : undefined}
              onClick={() => navigateToSection("how-to-use")}
              className={[
                "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item text-sm text-left transition-colors duration-fast",
                activeSection === "how-to-use"
                  ? "bg-glass-active text-text-1 font-medium"
                  : "text-text-2 hover:text-text-1 hover:bg-glass-hover",
              ].join(" ")}
            >
              <Question
                size={16}
                weight="regular"
                className={
                  activeSection === "how-to-use" ? "text-accent-soft shrink-0" : "text-text-2 shrink-0"
                }
              />
              <span className="truncate">Como usar</span>
            </button>
          </div>
        </aside>

        {/* Área de conteúdo à direita */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Top bar */}
          <header className="px-7 pt-5 pb-3 flex items-center justify-between shrink-0">
            <span className="text-xs text-text-3 font-normal">{meta.title}</span>

            <div className="flex items-center gap-3">
              {saveStatus === "error" && (
                <span className="text-xs text-danger" role="status" aria-live="polite">
                  {saveError || "Erro ao salvar"}
                </span>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar configurações"
                className="rounded-pill h-7 w-7 grid place-items-center text-text-2 hover:text-text-1 hover:bg-glass-hover transition-colors duration-fast"
              >
                <X size={15} weight="regular" />
              </button>
            </div>
          </header>

          {/* Corpo rolável da seção ativa */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 pt-2 arc-scroll settings-scroll-fade"
          >
            {renderSection()}
            {RESTORABLE_SECTIONS.includes(activeSection) && onStartRestore && onCancelRestore && (
              <div className="mt-8 pt-5 border-t border-line flex items-center justify-end">
                <RestoreDefaultsButton
                  scope={activeSection}
                  label="Restaurar padrão"
                  confirmTitle="Tem certeza que deseja restaurar esta seção?"
                  pending={pendingRestores?.[activeSection]}
                  onConfirmStart={onStartRestore}
                  onCancelPending={onCancelRestore}
                  variant="section"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
