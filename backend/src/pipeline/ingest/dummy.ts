import * as fs from "fs";
import * as path from "path";
import { getVideoDir, getVideoFilePath } from "../../core/settings";
import { appendTaskLog } from "../../core/taskLogs";
import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import { createDummyMP4 } from "../../utils/mp4";
import { IngestResult } from "./types";

export function createDummyFallback(job: Job, infoPath: string): IngestResult {
  // Fallback: criar um vídeo dummy MP4 para testar
  const mp4Buffer = createDummyMP4();
  let dummyPath = artifactService.sourceVideoPathForJob(job.job_id, "mp4");
  fs.writeFileSync(dummyPath, mp4Buffer);
  console.log(`[ingest] ✓ Vídeo dummy criado em: ${dummyPath} (${mp4Buffer.length} bytes)`);
  appendTaskLog(job.job_id, "ingest", "[ingest] Dummy video created");

  // Criar info JSON também
  const infoData = {
    id: "dummy",
    title: "Dummy Video for Testing",
    ext: "mp4",
    url: job.youtube_url,
  };
  artifactService.writeJsonArtifact(infoPath, infoData);
  console.log(`[ingest] ✓ Info JSON criado em: ${infoPath}`);
  appendTaskLog(job.job_id, "ingest", "[ingest] Info JSON created");

  const updatedJob = jobLifecycleService.loadJob(job.job_id);
  updatedJob.updated_at = new Date().toISOString();
  updatedJob.status = JobStatus.DOWNLOADED;
  updatedJob.video_name = updatedJob.video_name || "Dummy Video for Testing";
  if (updatedJob.video_name && updatedJob.video_name !== updatedJob.job_id) {
    const oldDir = path.dirname(dummyPath);
    const newDir = getVideoDir(updatedJob.job_id, updatedJob.video_name);
    if (oldDir !== newDir) {
      fs.renameSync(oldDir, newDir);
      dummyPath = getVideoFilePath(updatedJob.job_id, updatedJob.video_name, ".mp4");
    }
  }
  updatedJob.source_video_path = dummyPath;
  jobLifecycleService.saveJob(updatedJob);

  console.log(`[ingest] ============================================\n`);
  appendTaskLog(job.job_id, "ingest", "[ingest] Dummy flow completed");

  return {
    video_path: dummyPath,
    metadata_path: infoPath,
  };
}
