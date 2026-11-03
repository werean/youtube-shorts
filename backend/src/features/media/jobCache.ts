const CACHE_TTL_MS = 60000;

type CachedJob = {
  job: { source_video_path?: string; video_name?: string };
  timestamp: number;
};

const jobCache = new Map<string, CachedJob>();

export function readMediaJobCache(jobId: string): CachedJob["job"] | undefined {
  const cached = jobCache.get(jobId);
  if (!cached) {
    return undefined;
  }
  if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    jobCache.delete(jobId);
    return undefined;
  }
  return cached.job;
}

export function writeMediaJobCache(jobId: string, job: CachedJob["job"]): void {
  jobCache.set(jobId, { job, timestamp: Date.now() });
}

export function invalidateMediaJobCache(jobId?: string): void {
  if (jobId) {
    jobCache.delete(jobId);
    return;
  }
  jobCache.clear();
}
