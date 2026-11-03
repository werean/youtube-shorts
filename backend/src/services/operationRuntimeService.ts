/**
 * Service boundary for process-local operational runtime state.
 *
 * This centralizes in-memory state used for task logs, active processes,
 * render cancellation, batch progress, and dependency install sessions.
 */

import { AsyncLocalStorage } from "async_hooks";
import { spawn, type ChildProcess } from "child_process";
import type { TaskName } from "../core/taskLogs";
import * as taskLogs from "../core/taskLogs";
import type { DependencyInstallOptions } from "../features/dependencies/shared/dependencyTypes";
import type { BatchPipelineProgress } from "../features/jobs/batch/types";
import { killProcessTree } from "../pipeline/externalProcess";

const activeTranscriptions = new Map<string, ChildProcess>();
const cancelledTranscriptions = new Set<string>();
const activeDownloads = new Map<string, ChildProcess>();
const activeRenderings = new Map<string, Set<ChildProcess>>();
const cancelledRenderings = new Set<string>();
const failedRenderings = new Set<string>();
const activeBatchProcesses = new Map<string, BatchPipelineProgress>();
const activeJobRuns = new Set<string>();
const jobRunStorage = new AsyncLocalStorage<string>();

export class JobAlreadyRunningError extends Error {
  statusCode = 409;

  constructor(jobId: string) {
    super(`Job ${jobId} is already running`);
    this.name = "JobAlreadyRunningError";
  }
}

export async function runWithJobLock<T>(jobId: string, action: () => Promise<T>): Promise<T> {
  if (jobRunStorage.getStore() === jobId) {
    return action();
  }
  if (activeJobRuns.has(jobId)) {
    throw new JobAlreadyRunningError(jobId);
  }

  activeJobRuns.add(jobId);
  try {
    return await jobRunStorage.run(jobId, action);
  } finally {
    activeJobRuns.delete(jobId);
  }
}

export function clearTaskLogs(jobId: string, task: TaskName): void {
  taskLogs.clearTaskLogs(jobId, task);
}

export function appendTaskLog(jobId: string, task: TaskName, line: string): void {
  taskLogs.appendTaskLog(jobId, task, line);
}

export function appendTaskLogs(jobId: string, task: TaskName, lines: string[]): void {
  taskLogs.appendTaskLogs(jobId, task, lines);
}

export function getTaskLogs(jobId: string, task: TaskName): string[] {
  return taskLogs.getTaskLogs(jobId, task);
}

export function clearAllTaskLogs(jobId: string): void {
  taskLogs.clearAllTaskLogs(jobId);
}

export function activeTranscriptionJobIds(): string[] {
  return Array.from(activeTranscriptions.keys());
}

export function trackActiveTranscription(jobId: string, child: ChildProcess): void {
  activeTranscriptions.set(jobId, child);
}

export function markTranscriptionCancelled(jobId: string): void {
  cancelledTranscriptions.add(jobId);
}

export function isTranscriptionCancelled(jobId: string): boolean {
  return cancelledTranscriptions.has(jobId);
}

export function clearTranscriptionCancelled(jobId: string): void {
  cancelledTranscriptions.delete(jobId);
}

export function trackActiveDownload(jobId: string, child: ChildProcess): void {
  activeDownloads.set(jobId, child);
}

export function clearActiveDownload(jobId: string): void {
  activeDownloads.delete(jobId);
}

export function cancelActiveDownload(jobId: string): boolean {
  const child = activeDownloads.get(jobId);
  if (!child) {
    return false;
  }
  killProcessTree(child);
  activeDownloads.delete(jobId);
  return true;
}

export function clearActiveTranscription(jobId: string): void {
  activeTranscriptions.delete(jobId);
}

export function cancelActiveTranscriptionProcess(jobId: string, onCancel?: () => void): boolean {
  const child = activeTranscriptions.get(jobId);
  if (!child || !child.pid) {
    return false;
  }

  onCancel?.();

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error(`[transcription] Failed to cancel process for job ${jobId}:`, error);
  }

  activeTranscriptions.delete(jobId);
  return true;
}

export function conflictingActiveRenderingJobId(jobId: string): string | null {
  if (activeRenderings.size === 0 || activeRenderings.has(jobId)) {
    return null;
  }

  return Array.from(activeRenderings.keys())[0] || null;
}

export function isRenderingCancelled(jobId: string): boolean {
  return cancelledRenderings.has(jobId);
}

export function markRenderingFailed(jobId: string): void {
  failedRenderings.add(jobId);
}

export function isRenderingFailed(jobId: string): boolean {
  return failedRenderings.has(jobId);
}

export function killActiveRenderingProcesses(jobId: string): void {
  const children = activeRenderings.get(jobId);
  if (!children) {
    return;
  }
  for (const child of children) {
    killProcessTree(child);
  }
  activeRenderings.delete(jobId);
}

export function trackChildProcess(jobId: string, child: ChildProcess): void {
  let children = activeRenderings.get(jobId);
  if (!children) {
    children = new Set<ChildProcess>();
    activeRenderings.set(jobId, children);
  }

  children.add(child);

  child.once("exit", () => {
    const running = activeRenderings.get(jobId);
    if (!running) {
      return;
    }
    running.delete(child);
    if (running.size === 0) {
      activeRenderings.delete(jobId);
    }
  });
}

function stopChildProcess(child: ChildProcess): void {
  killProcessTree(child);
}

export function cancelActiveRendering(jobId: string, onCancelRequested: () => void): boolean {
  const children = activeRenderings.get(jobId);
  if (!children || children.size === 0) {
    return false;
  }

  onCancelRequested();
  cancelledRenderings.add(jobId);

  try {
    for (const child of children) {
      stopChildProcess(child);
    }
  } catch (error) {
    console.error(`[rendering] Failed to cancel process for job ${jobId}:`, error);
  }

  activeRenderings.delete(jobId);
  return true;
}

export function cleanupRenderingState(jobId: string): void {
  activeRenderings.delete(jobId);
  cancelledRenderings.delete(jobId);
  failedRenderings.delete(jobId);
}

export function createBatchProgress(batchId: string, jobIds: string[]): BatchPipelineProgress {
  const progress: BatchPipelineProgress = {
    current_job_index: 0,
    current_job_id: jobIds[0],
    current_step: "starting",
    completed_jobs: [],
    failed_jobs: [],
    is_running: true,
  };

  activeBatchProcesses.set(batchId, progress);
  return progress;
}

export function getBatchProgress(batchId: string): BatchPipelineProgress | undefined {
  return activeBatchProcesses.get(batchId);
}

export function markBatchNotRunning(batchId: string): void {
  const progress = activeBatchProcesses.get(batchId);
  if (progress) {
    progress.is_running = false;
  }
}

export function deleteBatchProgress(batchId: string): void {
  activeBatchProcesses.delete(batchId);
}

async function dependencySessionsRuntime() {
  return import("../features/dependencies/runtime/dependencySessions");
}

export async function cleanupInstallSessions() {
  const runtime = await dependencySessionsRuntime();
  return runtime.cleanupInstallSessions();
}

export async function startDependencyInstallSession(
  name: string,
  options: DependencyInstallOptions,
) {
  const runtime = await dependencySessionsRuntime();
  return runtime.startDependencyInstallSession(name, options);
}

export async function startDependencyUninstallSession(name: string) {
  const runtime = await dependencySessionsRuntime();
  return runtime.startDependencyUninstallSession(name);
}

export async function getDependencyInstallSessionPayload(sessionId: string) {
  const runtime = await dependencySessionsRuntime();
  return runtime.getDependencyInstallSessionPayload(sessionId);
}

export async function cancelDependencyInstallSession(sessionId: string) {
  const runtime = await dependencySessionsRuntime();
  return runtime.cancelDependencyInstallSession(sessionId);
}
