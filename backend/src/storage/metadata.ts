/**
 * Persistence layer for JSON metadata and decisions.
 */

import * as fs from "fs";
import * as path from "path";
import { Job, JobStatus } from "../models/job";
import { jobMetadataPath, jobsDir } from "../core/paths";

type CachedJobEntry = {
  value: Job;
  expiresAt: number;
};

const PRETTY_JSON = process.env.NODE_ENV !== "production";
const JOB_CACHE_TTL_MS = resolveCacheTtl("JOB_CACHE_TTL_MS", 2000);
const jobCache = new Map<string, CachedJobEntry>();

function resolveCacheTtl(envName: string, fallbackMs: number): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

function cloneJob(job: Job): Job {
  return { ...job };
}

function cacheJob(job: Job): void {
  jobCache.set(job.job_id, {
    value: cloneJob(job),
    expiresAt: Date.now() + JOB_CACHE_TTL_MS,
  });
}

function writeJsonFile(filePath: string, value: unknown): void {
  const content = PRETTY_JSON ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  fs.writeFileSync(filePath, content, "utf-8");
}

function readJobFromDisk(jobId: string): Job {
  const metadataPath = jobMetadataPath(jobId);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Job ${jobId} not found`);
  }
  const content = fs.readFileSync(metadataPath, "utf-8");
  return JSON.parse(content) as Job;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function invalidateJobCache(jobId?: string): void {
  if (jobId) {
    jobCache.delete(jobId);
    return;
  }
  jobCache.clear();
}

export function saveJob(job: Job): string {
  const metadataPath = jobMetadataPath(job.job_id);
  ensureDir(path.dirname(metadataPath));
  writeJsonFile(metadataPath, job);
  cacheJob(job);
  return metadataPath;
}

export function loadJob(jobId: string): Job {
  const cached = jobCache.get(jobId);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneJob(cached.value);
  }

  const job = readJobFromDisk(jobId);
  cacheJob(job);
  return cloneJob(job);
}

export function listJobs(): Job[] {
  const baseDir = jobsDir();
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const jobs: Job[] = [];
  const items = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const item of items) {
    if (!item.isDirectory()) {
      continue;
    }
    try {
      jobs.push(loadJob(item.name));
    } catch {
      // Ignore invalid/incomplete job folders.
    }
  }

  return jobs;
}

export function updateJobStatus(jobId: string, status: JobStatus): Job {
  const job = loadJob(jobId);
  job.status = status;
  job.updated_at = new Date().toISOString();
  saveJob(job);
  return job;
}
