type CachedSourceVideoEntry = {
  path: string;
  expiresAt: number;
};

function resolveCacheTtl(envName: string, fallbackMs: number): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

const SOURCE_VIDEO_CACHE_TTL_MS = resolveCacheTtl("SOURCE_VIDEO_CACHE_TTL_MS", 5000);
const sourceVideoCache = new Map<string, CachedSourceVideoEntry>();

export function setCachedSourceVideo(jobId: string, filePath: string): void {
  sourceVideoCache.set(jobId, {
    path: filePath,
    expiresAt: Date.now() + SOURCE_VIDEO_CACHE_TTL_MS,
  });
}

export function readCachedSourceVideo(jobId: string): string | null {
  const cached = sourceVideoCache.get(jobId);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    sourceVideoCache.delete(jobId);
    return null;
  }
  return cached.path;
}

export function invalidateSourceVideoCache(jobId?: string): void {
  if (jobId) {
    sourceVideoCache.delete(jobId);
    return;
  }
  sourceVideoCache.clear();
}
