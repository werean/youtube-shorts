// Client utilities
export { apiBaseUrl } from "./client";

// Jobs API
export {
  createJob,
  getJob,
  ingestJob,
  renameVideo,
  runJobPipeline,
  listJobAttempts,
  archiveJobAttempt,
  getJobAttempt,
  deleteJobAttempt,
} from "./jobs";

// Videos API
export {
  uploadVideoFile,
  listVideos,
  listArchivedVideos,
  archiveVideo,
  deleteVideo,
  openVideoFolder,
} from "./videos";

// Transcription API
export { transcribeJob, getTranscription, deleteTranscription, buildBlocks } from "./transcription";

// Cuts API
export { listCuts, updateCuts, approveCut, rejectCut, analyzeJob } from "./cuts";

// Rendering API
export { renderJob, listRenderOutputs, deleteRenderOutput, openRenderFolder } from "./rendering";

// Watermark API
export {
  getWatermark,
  updateWatermark,
  uploadWatermarkImage,
  deleteWatermarkImage,
  restoreWatermarkDefaults,
  buildWatermarkImageUrl,
  WATERMARK_DEFAULT_APPEARANCE,
  type WatermarkPatch,
  type WatermarkSettings,
} from "./watermark";

// Cancel API
export { cancelJob, cancelTranscription, cancelRendering } from "./cancel";

// Logs API
export { getJobLogs, openJobLogsFolder } from "./logs";

// Batch Pipeline API
export {
  startBatchPipeline,
  getBatchPipelineStatus,
  cancelBatchPipeline,
  continueBatchPipeline,
  type BatchPipelineOptions,
  type BatchPipelineProgress,
} from "./batchPipeline";

// Config API
export {
  getLLMPrompt,
  getDefaultLLMPrompt,
  getSavedLLMPrompts,
  saveLLMPrompt,
  getConfig,
  getOllamaModels,
  registerOllamaModel,
  removeOllamaModel,
  getDependencies,
  getInstallationGuide,
  installDependency,
  startDependencyInstallSession,
  startDependencyUninstallSession,
  getDependencyInstallSession,
  cancelDependencyInstallSession,
  openDependencyInstallTerminal,
  getSettings,
  saveSettings,
  getToolConfigs,
  saveToolConfigs,
  resetAppSettings,
  resetAllToolConfigs,
  resetToolConfigSection,
  importToolConfigs,
  getCommonFolders,
  selectFolder,
  type InstallationGuide,
  type AppSettings,
  type DependencyInstallSessionStatus,
  type DependencyOperationMode,
  type DependencyInstallOptions,
  type PytorchGpuTier,
  type RegisterOllamaModelRequest,
  type RegisterOllamaModelResponse,
  type RemoveOllamaModelResponse,
  type SavedLLMPrompt,
} from "./config";
