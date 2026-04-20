/**
 * Pipeline step: semantic analysis with LLM over blocks.
 */

import * as fs from "fs";
import { SemanticBlock } from "../models/semantic_block";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { OllamaClient } from "../llm/client";
import { buildCutSelectionPrompt } from "../llm/prompts";
import { loadActiveToolConfigs } from "../core/toolConfigs";

function loadBlocks(jobId: string): SemanticBlock[] {
  const path = files.semanticBlocksPath(jobId);
  if (!fs.existsSync(path)) {
    throw new Error("Semantic blocks JSON not found");
  }
  const content = fs.readFileSync(path, "utf-8");
  return JSON.parse(content);
}

function parseCuts(payload: any): Cut[] {
  if (!Array.isArray(payload)) {
    throw new Error("LLM response must be a JSON array");
  }

  const cutItems: Cut[] = [];
  for (let index = 0; index < payload.length; index++) {
    const item = payload[index];
    if (typeof item !== "object" || item === null) {
      throw new Error("LLM cut item must be a JSON object");
    }

    const blocks = item.blocks;
    const start = item.start;
    const end = item.end;
    const title = String(item.title || item.hook_reason || item.content_reason || "").trim();

    if (!Array.isArray(blocks) || start === undefined || end === undefined) {
      throw new Error("LLM cut item missing required fields");
    }

    cutItems.push({
      cut_id: `c${index + 1}`,
      block_ids: blocks.map((b: any) => String(b)),
      start: parseFloat(start),
      end: parseFloat(end),
      title: title || `Corte ${index + 1}`,
      status: "pending",
    });
  }

  return cutItems;
}

export async function analyzeBlocks(jobId: string): Promise<{ cuts: Cut[]; raw_response: string }> {
  console.log(`[analysis] Analyzing blocks for job ${jobId}`);
  metadata.updateJobStatus(jobId, JobStatus.ANALYZING);

  const blocks = loadBlocks(jobId);
  if (blocks.length === 0) {
    throw new Error("No semantic blocks available");
  }

  const toolConfigs = loadActiveToolConfigs();
  const prompt = buildCutSelectionPrompt(blocks);
  const model = toolConfigs.llm.model || undefined;
  const client = new OllamaClient(undefined, model);

  const systemPrompt = toolConfigs.llm.system_prompt || "You output JSON only.";
  const content = await client.chat([
    { role: "system", content: systemPrompt },
    { role: "system", content: "You output JSON only." },
    { role: "user", content: prompt },
  ]);

  let responseJson: any;
  try {
    responseJson = JSON.parse(content);
  } catch (error) {
    throw new Error("LLM response is not valid JSON");
  }

  const cuts = parseCuts(responseJson);
  const outputPath = files.cutsPath(jobId);
  fs.writeFileSync(outputPath, JSON.stringify(cuts, null, 2), "utf-8");
  console.log(`[analysis] Cuts saved for job ${jobId}`);

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);

  return { cuts, raw_response: content };
}
