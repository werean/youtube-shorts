/**
 * Persistence layer for JSON metadata and decisions.
 */

import * as fs from "fs";
import * as path from "path";
import { Job, JobStatus } from "../models/job";
import { jobMetadataPath, jobsDir } from "../core/paths";

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function saveJob(job: Job): string {
  try {
    console.log(`[metadata.saveJob] Iniciando save para job: ${job.job_id}`);
    const metadataPath = jobMetadataPath(job.job_id);
    console.log(`[metadata.saveJob] Metadata path: ${metadataPath}`);

    ensureDir(path.dirname(metadataPath));
    console.log(`[metadata.saveJob] Diretório garantido`);

    fs.writeFileSync(metadataPath, JSON.stringify(job, null, 2), "utf-8");
    console.log(`[metadata.saveJob] ✓ Job salvo com sucesso em: ${metadataPath}`);
    return metadataPath;
  } catch (error: any) {
    console.error(`[metadata.saveJob] ✗ Erro ao salvar job:`, error.message);
    console.error(`[metadata.saveJob] Stack:`, error.stack);
    throw error;
  }
}

export function loadJob(jobId: string): Job {
  try {
    console.log(`[metadata.loadJob] Carregando job: ${jobId}`);
    const metadataPath = jobMetadataPath(jobId);
    console.log(`[metadata.loadJob] Procurando em: ${metadataPath}`);

    if (!fs.existsSync(metadataPath)) {
      console.error(`[metadata.loadJob] ✗ Arquivo não encontrado: ${metadataPath}`);
      throw new Error(`Job ${jobId} not found`);
    }

    const content = fs.readFileSync(metadataPath, "utf-8");
    const job = JSON.parse(content) as Job;
    console.log(`[metadata.loadJob] ✓ Job carregado com status: ${job.status}`);
    return job;
  } catch (error: any) {
    console.error(`[metadata.loadJob] ✗ Erro ao carregar job:`, error.message);
    throw error;
  }
}

export function listJobs(): Job[] {
  const baseDir = jobsDir();
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const jobs: Job[] = [];
  const items = fs.readdirSync(baseDir);

  for (const item of items) {
    const itemPath = path.join(baseDir, item);
    if (fs.statSync(itemPath).isDirectory()) {
      const metadataPath = path.join(itemPath, "job.json");
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, "utf-8");
        jobs.push(JSON.parse(content) as Job);
      }
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
