// Client utilities
export { apiBaseUrl } from "./client";

// Jobs API
export { createJob, getJob, ingestJob, renameVideo } from "./jobs";

// Videos API
export {
  uploadVideoFile,
  listVideos,
  listArchivedVideos,
  archiveVideo,
  deleteVideo,
} from "./videos";

// Transcription API
export { transcribeJob, getTranscription, deleteTranscription, buildBlocks } from "./transcription";

// Cuts API
export { listCuts, updateCuts, approveCut, rejectCut, analyzeJob } from "./cuts";

// Rendering API
export { renderJob, listRenderOutputs, deleteRenderOutput } from "./rendering";

// Cancel API
export { cancelTranscription, cancelRendering } from "./cancel";

// Logs API
export { getJobLogs } from "./logs";

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
  getConfig,
  getDependencies,
  getInstallationGuide,
  installDependency,
  getSettings,
  saveSettings,
  getToolConfigs,
  saveToolConfigs,
  resetAllToolConfigs,
  resetToolConfigSection,
  importToolConfigs,
  getCommonFolders,
  selectFolder,
  type InstallationGuide,
  type AppSettings,
} from "./config";
