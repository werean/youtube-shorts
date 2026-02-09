import { useState, useCallback } from "react";

export function useUIState() {
  // Upload
  const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Video view
  const [videoView, setVideoView] = useState<"active" | "archived">("active");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Transcription UI
  const [showTranscriptionFormatListDialog, setShowTranscriptionFormatListDialog] = useState(false);
  const [showTranscriptionContentDialog, setShowTranscriptionContentDialog] = useState(false);
  const [showTranscriptionDeleteDialog, setShowTranscriptionDeleteDialog] = useState(false);
  const [selectedTranscriptionFormat, setSelectedTranscriptionFormat] = useState<
    "text" | "vtt" | "segments" | null
  >(null);
  const [pendingDeleteFormat, setPendingDeleteFormat] = useState<
    "text" | "vtt" | "segments" | null
  >(null);

  // Blocks & Analysis UI
  const [showBlocksDialog, setShowBlocksDialog] = useState(false);
  const [showAiResponseDialog, setShowAiResponseDialog] = useState(false);
  const [showAiResponseOnAnalyze, setShowAiResponseOnAnalyze] = useState(false);
  const [showRegenerateAnalyzeDialog, setShowRegenerateAnalyzeDialog] = useState(false);

  // Cut edit UI
  const [showCutEditDialog, setShowCutEditDialog] = useState(false);
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editCutStart, setEditCutStart] = useState<string>("");
  const [editCutEnd, setEditCutEnd] = useState<string>("");
  const [editCutStartMinutes, setEditCutStartMinutes] = useState<string>("");
  const [editCutStartSeconds, setEditCutStartSeconds] = useState<string>("");
  const [editCutEndMinutes, setEditCutEndMinutes] = useState<string>("");
  const [editCutEndSeconds, setEditCutEndSeconds] = useState<string>("");
  const [hoveredCutId, setHoveredCutId] = useState<string | null>(null);
  const [hoveredCutAction, setHoveredCutAction] = useState<"edit" | "delete" | null>(null);

  // Config dialogs
  const [showLLMConfigDialog, setShowLLMConfigDialog] = useState(false);
  const [showWhisperConfigDialog, setShowWhisperConfigDialog] = useState(false);
  const [showDependenciesDialog, setShowDependenciesDialog] = useState(false);
  const [showInstallationDialog, setShowInstallationDialog] = useState(false);
  const [showConfigureAppDialog, setShowConfigureAppDialog] = useState(false);

  // Rename & Upload dialogs
  const [renameVideoId, setRenameVideoId] = useState<string | null>(null);
  const [renameVideoNewName, setRenameVideoNewName] = useState<string>("");
  const [showMoveUploadDialog, setShowMoveUploadDialog] = useState(false);
  const [dontAskMoveUpload, setDontAskMoveUpload] = useState(false);

  // Dependencies
  const [selectedDependencyForInstall, setSelectedDependencyForInstall] = useState<string | null>(
    null,
  );
  const [installingDependency, setInstallingDependency] = useState<string | null>(null);

  const closeAllDialogs = useCallback(() => {
    setShowTranscriptionFormatListDialog(false);
    setShowTranscriptionContentDialog(false);
    setShowTranscriptionDeleteDialog(false);
    setShowBlocksDialog(false);
    setShowAiResponseDialog(false);
    setShowRegenerateAnalyzeDialog(false);
    setShowCutEditDialog(false);
    setShowLLMConfigDialog(false);
    setShowWhisperConfigDialog(false);
    setShowDependenciesDialog(false);
    setShowInstallationDialog(false);
    setShowConfigureAppDialog(false);
    setRenameVideoId(null);
    setShowMoveUploadDialog(false);
  }, []);

  return {
    // Upload
    uploadMode,
    youtubeUrl,
    selectedFiles,
    isDraggingFile,
    setUploadMode,
    setYoutubeUrl,
    setSelectedFiles,
    setIsDraggingFile,

    // Video view
    videoView,
    menuOpenId,
    setVideoView,
    setMenuOpenId,

    // Transcription
    showTranscriptionFormatListDialog,
    showTranscriptionContentDialog,
    showTranscriptionDeleteDialog,
    selectedTranscriptionFormat,
    pendingDeleteFormat,
    setShowTranscriptionFormatListDialog,
    setShowTranscriptionContentDialog,
    setShowTranscriptionDeleteDialog,
    setSelectedTranscriptionFormat,
    setPendingDeleteFormat,

    // Blocks & Analysis
    showBlocksDialog,
    showAiResponseDialog,
    showAiResponseOnAnalyze,
    showRegenerateAnalyzeDialog,
    setShowBlocksDialog,
    setShowAiResponseDialog,
    setShowAiResponseOnAnalyze,
    setShowRegenerateAnalyzeDialog,

    // Cut edit
    showCutEditDialog,
    editingCutId,
    editCutStart,
    editCutEnd,
    editCutStartMinutes,
    editCutStartSeconds,
    editCutEndMinutes,
    editCutEndSeconds,
    hoveredCutId,
    hoveredCutAction,
    setShowCutEditDialog,
    setEditingCutId,
    setEditCutStart,
    setEditCutEnd,
    setEditCutStartMinutes,
    setEditCutStartSeconds,
    setEditCutEndMinutes,
    setEditCutEndSeconds,
    setHoveredCutId,
    setHoveredCutAction,

    // Config
    showLLMConfigDialog,
    showWhisperConfigDialog,
    showDependenciesDialog,
    showInstallationDialog,
    showConfigureAppDialog,
    setShowLLMConfigDialog,
    setShowWhisperConfigDialog,
    setShowDependenciesDialog,
    setShowInstallationDialog,
    setShowConfigureAppDialog,

    // Rename & Upload
    renameVideoId,
    renameVideoNewName,
    showMoveUploadDialog,
    dontAskMoveUpload,
    setRenameVideoId,
    setRenameVideoNewName,
    setShowMoveUploadDialog,
    setDontAskMoveUpload,

    // Dependencies
    selectedDependencyForInstall,
    installingDependency,
    setSelectedDependencyForInstall,
    setInstallingDependency,

    // Utilities
    closeAllDialogs,
  };
}
