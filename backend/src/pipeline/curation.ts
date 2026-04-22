/**
 * Pipeline step: human curation of suggested cuts.
 */

import * as fs from "fs";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as jobLifecycleService from "../services/jobLifecycleService";
import * as files from "../storage/files";

function loadCuts(jobId: string): Cut[] {
  const path = files.cutsPath(jobId);
  if (!fs.existsSync(path)) {
    return [];
  }
  const content = fs.readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function saveCuts(jobId: string, cuts: Cut[]): void {
  const path = files.cutsPath(jobId);
  fs.writeFileSync(path, JSON.stringify(cuts, null, 2), "utf-8");
}

export function listSuggestions(jobId: string): Cut[] {
  console.log(`[curation] Listing cuts for job ${jobId}`);
  return loadCuts(jobId);
}

export function approveCut(jobId: string, cutId: string): Cut {
  console.log(`[curation] Approving cut ${cutId} for job ${jobId}`);

  const cuts = loadCuts(jobId);
  let updated = false;
  let approvedCut: Cut | null = null;

  for (const cut of cuts) {
    if (cut.cut_id === cutId) {
      cut.status = "approved";
      approvedCut = cut;
      updated = true;
      break;
    }
  }

  if (!updated) {
    throw new Error("Cut id not found");
  }

  saveCuts(jobId, cuts);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);

  return approvedCut!;
}

export function rejectCut(jobId: string, cutId: string): Cut {
  console.log(`[curation] Rejecting cut ${cutId} for job ${jobId}`);

  const cuts = loadCuts(jobId);
  let updated = false;
  let rejectedCut: Cut | null = null;

  for (const cut of cuts) {
    if (cut.cut_id === cutId) {
      cut.status = "rejected";
      rejectedCut = cut;
      updated = true;
      break;
    }
  }

  if (!updated) {
    throw new Error("Cut id not found");
  }

  saveCuts(jobId, cuts);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);

  return rejectedCut!;
}
