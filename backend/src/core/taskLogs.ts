/**
 * In-memory task logs for transcription and rendering.
 */

type TaskName = "transcription" | "render" | "ingest";

type TaskLogStore = {
  transcription: string[];
  render: string[];
  ingest: string[];
};

const MAX_LOG_LINES = 400;
const logsByJob = new Map<string, TaskLogStore>();

function getOrCreate(jobId: string): TaskLogStore {
  const existing = logsByJob.get(jobId);
  if (existing) return existing;
  const created: TaskLogStore = { transcription: [], render: [], ingest: [] };
  logsByJob.set(jobId, created);
  return created;
}

function trimLogs(lines: string[]): string[] {
  if (lines.length <= MAX_LOG_LINES) return lines;
  return lines.slice(lines.length - MAX_LOG_LINES);
}

export function clearTaskLogs(jobId: string, task: TaskName): void {
  const store = getOrCreate(jobId);
  store[task] = [];
}

export function appendTaskLog(jobId: string, task: TaskName, line: string): void {
  const store = getOrCreate(jobId);
  store[task] = trimLogs([...store[task], line]);
}

export function appendTaskLogs(jobId: string, task: TaskName, lines: string[]): void {
  if (lines.length === 0) return;
  const store = getOrCreate(jobId);
  store[task] = trimLogs([...store[task], ...lines]);
}

export function getTaskLogs(jobId: string, task: TaskName): string[] {
  const store = getOrCreate(jobId);
  return store[task];
}

export function clearAllTaskLogs(jobId: string): void {
  const store = getOrCreate(jobId);
  store.transcription = [];
  store.render = [];
  store.ingest = [];
}
