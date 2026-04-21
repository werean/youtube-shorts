import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";
import { JobStatus, type Job } from "../../../src/models/job";

let app: FastifyInstance;
let tempRoot = "";
const jobs = new Map<string, Job>();
const invalidatedJobIds: Array<string | undefined> = [];
const openFolderCalls: Array<{ filePath: string; allowedRoots?: string[] }> = [];
let openFolderResult = { ok: true } as { ok: boolean; detail?: string };

function cloneJob(job: Job): Job {
  return { ...job };
}

function mediaBaseDir(): string {
  return path.join(tempRoot, "media");
}

function dataJobsDir(): string {
  return path.join(tempRoot, "data", "jobs");
}

function getVideoFolder(videoName: string): string {
  return videoName.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

function getVideoDir(_jobId: string, videoName?: string): string {
  return path.join(mediaBaseDir(), videoName ? getVideoFolder(videoName) : _jobId);
}

function getVideoFilePath(jobId: string, videoName?: string, extension = ".mp4"): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return path.join(getVideoDir(jobId, videoName), `video${ext}`);
}

function getTranscriptionsDir(jobId: string, videoName?: string): string {
  const dir = path.join(getVideoDir(jobId, videoName), "transcrições");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getShortsDir(jobId: string, videoName?: string): string {
  const dir = path.join(getVideoDir(jobId, videoName), "shorts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function archivedVideosDir(): string {
  const dir = path.join(mediaBaseDir(), "_archived");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getArchivedVideoDir(videoName: string): string {
  const dir = path.join(archivedVideosDir(), getVideoFolder(videoName));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  return dir;
}

function jobDir(jobId: string): string {
  return path.join(dataJobsDir(), jobId);
}

function makeJob(jobId: string, videoName: string, sourceVideoPath?: string): Job {
  return {
    job_id: jobId,
    youtube_url: `[Local Video] ${videoName}`,
    status: JobStatus.DOWNLOADED,
    created_at: "2026-04-21T00:00:00.000Z",
    source_video_path: sourceVideoPath,
    source_file_name: "video.mp4",
    video_name: videoName,
  };
}

function createVideo(jobId: string, videoName: string, content = "video-bytes"): Job {
  const videoPath = getVideoFilePath(jobId, videoName, ".mp4");
  fs.mkdirSync(path.dirname(videoPath), { recursive: true });
  fs.writeFileSync(videoPath, content, "utf-8");
  const job = makeJob(jobId, videoName, videoPath);
  jobs.set(jobId, job);
  return job;
}

mock.module("../../../src/storage/metadata", () => ({
  invalidateJobCache: (jobId?: string) => {
    invalidatedJobIds.push(jobId);
  },
  listJobs: () => Array.from(jobs.values()).map(cloneJob),
  loadJob: (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }
    return cloneJob(job);
  },
  saveJob: (job: Job) => {
    jobs.set(job.job_id, cloneJob(job));
    fs.mkdirSync(jobDir(job.job_id), { recursive: true });
    fs.writeFileSync(path.join(jobDir(job.job_id), "job.json"), JSON.stringify(job, null, 2));
    return path.join(jobDir(job.job_id), "job.json");
  },
}));

mock.module("../../../src/core/settings", () => ({
  archivedVideosDir,
  getArchivedVideoDir,
  getShortsDir,
  getTranscriptionsDir,
  getVideoDir,
  getVideoFilePath,
  getVideoFolder,
  loadSettings: () => ({
    media: {
      base_dir: mediaBaseDir(),
      download_resolution: "1080p",
    },
    preferences: {
      ask_delete_cut_confirm: true,
      ask_move_on_upload: true,
      move_uploads: true,
    },
    whisper: {
      device: "cuda",
      formats: ["json"],
    },
    llm: {
      model: "test-model",
    },
  }),
}));

mock.module("../../../src/core/paths", () => ({
  jobDir,
}));

mock.module("../../../src/utils/openFolder", () => ({
  openFolderInExplorerForFile: (filePath: string, allowedRoots?: string[]) => {
    openFolderCalls.push({ filePath, allowedRoots });
    return openFolderResult;
  },
}));

const { default: videosRoutes } = await import("../../../src/routes/videosRoutes");
const { default: mediaRoutes } = await import("../../../src/routes/mediaRoutes");

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function request(
  method: "GET" | "POST" | "DELETE",
  routePath: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl()}${routePath}`, {
    ...init,
    method,
  });
}

describe("artifact and path lifecycle routes", () => {
  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-artifacts-"));
    jobs.clear();
    invalidatedJobIds.length = 0;
    openFolderCalls.length = 0;
    openFolderResult = { ok: true };

    app = createServer();
    await app.register(videosRoutes);
    await app.register(mediaRoutes);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("archive moves the active video folder and rewrites source_video_path to the archived video", async () => {
    const job = createVideo("job-archive", "Original Video");
    const originalDir = path.dirname(job.source_video_path!);

    const response = await request("POST", "/videos/job-archive/archive");
    const body = await response.json();

    const archivedPath = path.join(getArchivedVideoDir("Original Video"), "video.mp4");
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, job_id: "job-archive" });
    expect(fs.existsSync(originalDir)).toBe(false);
    expect(fs.existsSync(archivedPath)).toBe(true);
    expect(jobs.get("job-archive")?.source_video_path).toBe(archivedPath);
  });

  test("delete removes video data and invalidates metadata caches, while preserving the current empty active-dir behavior", async () => {
    const job = createVideo("job-delete", "Delete Me");
    const activeDir = path.dirname(job.source_video_path!);
    const archivedDir = getArchivedVideoDir("Delete Me");
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, "video.mp4"), "archived", "utf-8");
    fs.mkdirSync(jobDir("job-delete"), { recursive: true });
    fs.writeFileSync(path.join(jobDir("job-delete"), "job.json"), "{}", "utf-8");

    const response = await request("DELETE", "/videos/job-delete");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, job_id: "job-delete" });
    expect(fs.existsSync(path.join(activeDir, "video.mp4"))).toBe(false);
    expect(fs.existsSync(archivedDir)).toBe(false);
    expect(fs.existsSync(jobDir("job-delete"))).toBe(false);
    expect(invalidatedJobIds).toContain("job-delete");
    expect(fs.existsSync(activeDir)).toBe(true);
    expect(fs.readdirSync(activeDir)).toEqual([]);
  });

  test("open-folder uses source_video_path with active and archived media roots as allowed roots", async () => {
    const job = createVideo("job-open", "Open Folder");

    const response = await request("POST", "/videos/job-open/open-folder");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(openFolderCalls).toEqual([
      {
        filePath: job.source_video_path,
        allowedRoots: [mediaBaseDir(), archivedVideosDir()],
      },
    ]);
  });

  test("media video route requires source_video_path on the job", async () => {
    jobs.set("job-no-source", makeJob("job-no-source", "Missing Source"));

    const response = await request("GET", "/media/videos/job-no-source");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ detail: "Video path not set" });
  });

  test("media video route serves byte ranges from source_video_path", async () => {
    createVideo("job-media", "Media Video", "0123456789");

    const response = await request("GET", "/media/videos/job-media", {
      headers: {
        range: "bytes=2-5",
      },
    });
    const body = await response.text();

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(body).toBe("2345");
  });
});
