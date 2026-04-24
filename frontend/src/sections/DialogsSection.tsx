/**
 * Seção de Diálogos - Extrai toda a renderização de diálogos do App.tsx
 * Responsável apenas pela renderização de diálogos baseado em estado externo
 */

import { ReactNode } from "react";
import type { ActionState } from "../hooks/useAppAction";
import type { VideoItem } from "../hooks/useVideoManagement";
import type { WhisperConfig } from "../types/whisper";

// Dialog components
import { TranscriptionFormatListDialog } from "../components/dialogs/TranscriptionFormatListDialog";
import { TranscriptionContentDialog } from "../components/dialogs/TranscriptionContentDialog";
import { TranscriptionDeleteDialog } from "../components/dialogs/TranscriptionDeleteDialog";
import { BlocksDialog } from "../components/dialogs/BlocksDialog";
import { AiResponseDialog } from "../components/dialogs/AiResponseDialog";
import { RegenerateAnalyzeDialog } from "../components/dialogs/RegenerateAnalyzeDialog";
import { CutEditDialog } from "../components/dialogs/CutEditDialog";
import { RenameVideoDialog } from "../components/dialogs/RenameVideoDialog";
import { ConfigureAppDialog } from "../components/dialogs/ConfigureAppDialog";
import { LLMConfigDialog } from "../components/dialogs/LLMConfigDialog";
import { WhisperConfigDialog } from "../components/dialogs/WhisperConfigDialog";
import { InstallationInstructionsDialog } from "../components/dialogs/InstallationInstructionsDialog";
import { MoveUploadDialog } from "../components/dialogs/MoveUploadDialog";

export interface DialogsProps {
  // Transcription dialog state
  showTranscriptionFormatListDialog: boolean;
  showTranscriptionContentDialog: boolean;
  showTranscriptionDeleteDialog: boolean;
  selectedTranscriptionFormat: "text" | "vtt" | "segments" | null;
  pendingDeleteFormat: "text" | "vtt" | "segments" | null;

  // Analysis dialogs
  showBlocksDialog: boolean;
  showAiResponseDialog: boolean;
  showRegenerateAnalyzeDialog: boolean;

  // Edit dialogs
  showCutEditDialog: boolean;
  editingCutId: string | null;
  editCutStartMinutes: string;
  editCutStartSeconds: string;
  editCutEndMinutes: string;
  editCutEndSeconds: string;

  // Rename
  renameVideoId: string | null;
  renameVideoNewName: string;

  // Config dialogs
  showLLMConfigDialog: boolean;
  showWhisperConfigDialog: boolean;
  showConfigureAppDialog: boolean;
  showInstallationDialog: boolean;
  showMoveUploadDialog: boolean;
  selectedDependencyForInstall: string | null;

  // Action state
  action: ActionState;
  actionError?: string;

  // Data
  activeVideo: VideoItem | undefined;
  blocks: Record<string, unknown>[];
  suggestedCuts: any[];
  aiResponseRaw: string | null;

  // LLM/Config data
  llmSystemPrompt: string;
  whisperDevice: "cpu" | "cuda";
  whisperFormats: string[];
  whisperConfig?: Partial<WhisperConfig>;
  configBaseDir: string;
  configDownloadResolution: "1080p" | "1440p" | "4k";
  appSettings: any;

  // Callbacks
  onCloseTranscriptionFormatList: () => void;
  onCloseTranscriptionContent: () => void;
  onCloseTranscriptionDelete: () => void;
  onSelectTranscriptionFormat: (format: "text" | "vtt" | "segments") => void;
  onDeleteTranscription: (format: "text" | "vtt" | "segments") => Promise<void>;

  onCloseBlocksDialog: () => void;
  onCloseAiResponseDialog: () => void;
  onCloseRegenerateDialog: () => void;

  onCloseCutEditDialog: () => void;
  onSaveCutEdit: (startMin: number, startSec: number, endMin: number, endSec: number) => void;

  onCloseRenameDialog: () => void;
  onSaveRename: (newName: string) => Promise<void>;

  onCloseLLMConfig: () => void;
  onSaveLLMConfig: (prompt: string) => void;

  onCloseWhisperConfig: () => void;
  onSaveWhisperConfig: (config: Partial<WhisperConfig>) => Promise<void>;

  onCloseConfigureApp: () => void;
  onSaveConfigureApp: (
    baseDir: string,
    resolution: "1080p" | "1440p" | "4k",
    askDeleteCutConfirm: boolean,
  ) => Promise<void>;

  onCloseInstallationDialog: () => void;
  onCloseMoveUploadDialog: () => void;
}

export function DialogsSection(props: DialogsProps): ReactNode {
  return (
    <>
      {/* DIÁLOGOS - Transcrição */}
      {props.showTranscriptionFormatListDialog && props.activeVideo && (
        <TranscriptionFormatListDialog
          activeVideoHasText={props.activeVideo?.transcriptionFormats?.text || false}
          activeVideoHasVtt={props.activeVideo?.transcriptionFormats?.vtt || false}
          activeVideoHasSegments={props.activeVideo?.transcriptionFormats?.segments || false}
          onClose={props.onCloseTranscriptionFormatList}
          onSelectFormat={props.onSelectTranscriptionFormat}
        />
      )}

      {props.showTranscriptionContentDialog &&
        props.activeVideo &&
        props.selectedTranscriptionFormat && (
          <TranscriptionContentDialog
            title={`Transcrição - ${
              props.selectedTranscriptionFormat === "segments"
                ? "JSON"
                : props.selectedTranscriptionFormat?.toUpperCase()
            }`}
            content={
              props.selectedTranscriptionFormat === "text"
                ? props.activeVideo?.transcription || ""
                : props.selectedTranscriptionFormat === "vtt"
                  ? props.activeVideo?.transcription || ""
                  : JSON.stringify(props.activeVideo?.transcriptionSegments || [])
            }
            selectedFormat={props.selectedTranscriptionFormat}
            onClose={props.onCloseTranscriptionContent}
            onDelete={(format) => {
              props.onDeleteTranscription(format);
            }}
          />
        )}

      {props.showTranscriptionDeleteDialog && props.activeVideo && props.pendingDeleteFormat && (
        <TranscriptionDeleteDialog
          pendingDeleteFormat={props.pendingDeleteFormat}
          action={props.action}
          onConfirm={props.onDeleteTranscription}
          onCancel={props.onCloseTranscriptionDelete}
        />
      )}

      {/* DIÁLOGOS - Análise */}
      {props.showBlocksDialog && props.blocks.length > 0 && (
        <BlocksDialog blocks={props.blocks} onClose={props.onCloseBlocksDialog} />
      )}

      {props.showAiResponseDialog && props.aiResponseRaw && (
        <AiResponseDialog
          aiResponseRaw={props.aiResponseRaw}
          onClose={props.onCloseAiResponseDialog}
        />
      )}

      {props.showRegenerateAnalyzeDialog && props.suggestedCuts.length > 0 && props.activeVideo && (
        <RegenerateAnalyzeDialog
          suggestedCuts={props.suggestedCuts}
          action={props.action}
          onMaintainSelected={() => props.onCloseRegenerateDialog()}
          onRegenerateAll={() => props.onCloseRegenerateDialog()}
          onCancel={props.onCloseRegenerateDialog}
        />
      )}

      {/* DIÁLOGOS - Edição de Cortes */}
      {props.showCutEditDialog && props.editingCutId && (
        <CutEditDialog
          editCutStartMinutes={props.editCutStartMinutes}
          editCutStartSeconds={props.editCutStartSeconds}
          editCutEndMinutes={props.editCutEndMinutes}
          editCutEndSeconds={props.editCutEndSeconds}
          action={props.action}
          onSave={props.onSaveCutEdit}
          onCancel={props.onCloseCutEditDialog}
        />
      )}

      {/* DIÁLOGOS - Renomear Vídeo */}
      {props.renameVideoId && (
        <RenameVideoDialog
          videoName={props.renameVideoNewName}
          action={props.action}
          onSave={props.onSaveRename}
          onCancel={props.onCloseRenameDialog}
        />
      )}

      {/* DIÁLOGOS - Configuração */}
      {props.showLLMConfigDialog && (
        <LLMConfigDialog
          llmSystemPrompt={props.llmSystemPrompt}
          action={props.action}
          onSave={props.onSaveLLMConfig}
          onCancel={props.onCloseLLMConfig}
        />
      )}

      {props.showWhisperConfigDialog && (
        <WhisperConfigDialog
          whisperDevice={props.whisperDevice}
          whisperFormats={props.whisperFormats}
          initialConfig={props.whisperConfig}
          action={props.action}
          onSave={props.onSaveWhisperConfig}
          onCancel={props.onCloseWhisperConfig}
        />
      )}

      {props.showConfigureAppDialog && (
        <ConfigureAppDialog
          configBaseDir={props.configBaseDir}
          configDownloadResolution={props.configDownloadResolution}
          appSettings={props.appSettings}
          action={props.action}
          onSave={props.onSaveConfigureApp}
          onCancel={props.onCloseConfigureApp}
        />
      )}

      {props.showInstallationDialog && props.selectedDependencyForInstall && (
        <div className="dialog-overlay" onClick={props.onCloseInstallationDialog}>
          <InstallationInstructionsDialog
            dependencyName={props.selectedDependencyForInstall}
            onClose={props.onCloseInstallationDialog}
          />
        </div>
      )}

      {props.showMoveUploadDialog && (
        <MoveUploadDialog
          onClose={props.onCloseMoveUploadDialog}
          onConfirmMove={props.onCloseMoveUploadDialog}
          onConfirmKeep={props.onCloseMoveUploadDialog}
        />
      )}

      {/* Toast de erro */}
      {props.action.error && <div className="toast error">{props.action.error}</div>}
    </>
  );
}
