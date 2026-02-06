/**
 * API endpoints for job lifecycle (create, status, approvals).
 */

import { FastifyPluginAsync } from "fastify";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import * as ingest from "../pipeline/ingest";
import * as transcription from "../pipeline/transcription";
import * as semanticBlocks from "../pipeline/semantic_blocks";
import * as analysis from "../pipeline/analysis";
import * as curation from "../pipeline/curation";
import * as rendering from "../pipeline/rendering";
import * as orchestrator from "../pipeline/orchestrator";
import * as files from "../storage/files";
import * as paths from "../core/paths";

interface CreateJobRequest {
  youtube_url: string;
}

interface RunPipelineRequest {
  include_render?: boolean;
}

const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  // Create job
  fastify.post("", async (request, reply) => {
    try {
      console.log(`[POST /jobs] Request recebido`);
      const body = request.body as CreateJobRequest;
      console.log(`[POST /jobs] Creating job for URL: ${body.youtube_url}`);

      const jobId = uuidv4().replace(/-/g, "");
      console.log(`[POST /jobs] Job ID gerado: ${jobId}`);

      const job: Job = {
        job_id: jobId,
        youtube_url: body.youtube_url,
        status: JobStatus.CREATED,
        created_at: new Date().toISOString(),
      };

      console.log(`[POST /jobs] Salvando job...`);
      metadata.saveJob(job);
      console.log(`[POST /jobs] ✓ Job criado com sucesso: ${jobId}`);
      return job;
    } catch (error: any) {
      console.error(`[POST /jobs] ✗ Erro:`, error.message);
      console.error(`[POST /jobs] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });

  // Upload video file
  fastify.post("/upload", async (request, reply) => {
    try {
      console.log(`[POST /jobs/upload] Request recebido`);

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ detail: "No file uploaded" });
      }

      console.log(`[POST /jobs/upload] Arquivo recebido: ${data.filename}`);
      console.log(`[POST /jobs/upload] Tipo: ${data.mimetype}`);

      const jobId = uuidv4().replace(/-/g, "");
      console.log(`[POST /jobs/upload] Job ID gerado: ${jobId}`);

      // Create upload directory
      const uploadJobDir = paths.uploadJobDir(jobId);
      if (!fs.existsSync(uploadJobDir)) {
        fs.mkdirSync(uploadJobDir, { recursive: true });
      }

      // Determine file extension
      const fileExtension = path.extname(data.filename);
      const videoFileName = `source${fileExtension}`;
      const videoPath = path.join(uploadJobDir, videoFileName);

      console.log(`[POST /jobs/upload] Salvando em: ${videoPath}`);

      // Save file
      await pipeline(data.file, fs.createWriteStream(videoPath));
      console.log(`[POST /jobs/upload] ✓ Arquivo salvo`);

      // Create job
      const job: Job = {
        job_id: jobId,
        youtube_url: `[Local Upload] ${data.filename}`,
        status: JobStatus.DOWNLOADED,
        created_at: new Date().toISOString(),
      };

      console.log(`[POST /jobs/upload] Salvando job...`);
      metadata.saveJob(job);
      console.log(`[POST /jobs/upload] ✓ Job criado com sucesso: ${jobId}`);

      return {
        job: job,
        video_path: videoFileName,
      };
    } catch (error: any) {
      console.error(`[POST /jobs/upload] ✗ Erro:`, error.message);
      console.error(`[POST /jobs/upload] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });

  // Get job
  fastify.get<{ Params: { job_id: string } }>("/:job_id", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[GET /jobs/:job_id] Request para job: ${job_id}`);
      const job = metadata.loadJob(job_id);
      console.log(`[GET /jobs/:job_id] ✓ Job carregado - Status: ${job.status}`);
      return job;
    } catch (error: any) {
      console.error(`[GET /jobs/:job_id] ✗ Erro ao carregar job:`, error.message);
      reply.code(404).send({ detail: error.message });
    }
  });

  // Ingest
  fastify.post<{ Params: { job_id: string } }>("/:job_id/ingest", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Ingesting job: ${job_id}`);
      const job = metadata.loadJob(job_id);
      const result = ingest.ingestVideo(job);

      // Extract just the filename for the frontend
      const videoFileName = result.video_path.split(/[\\/]/).pop() || "source.mp4";

      return {
        video_path: videoFileName,
        metadata_path: result.metadata_path,
        full_path: result.video_path, // Keep full path for debugging
      };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Transcribe
  fastify.post<{ Params: { job_id: string } }>("/:job_id/transcribe", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Transcribing job: ${job_id}`);
      const formats = { text: true, vtt: true };
      const segments = transcription.transcribeJob(job_id, formats);

      // Combine segments into full transcription text
      const transcriptionText = segments.map((s: any) => s.text).join(" ");

      return {
        transcription: transcriptionText,
        segments: segments,
        available_formats: {
          segments: true,
          text: Boolean(formats.text),
          vtt: Boolean(formats.vtt),
        },
      };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Get transcription
  fastify.get<{ Params: { job_id: string } }>("/:job_id/transcription", async (request, reply) => {
    try {
      const { job_id } = request.params;
      const transcriptionPath = files.transcriptionPath(job_id);
      const textPath = files.transcriptionTextPath(job_id);
      const vttPath = files.transcriptionVttPath(job_id);
      const hasSegments = fs.existsSync(transcriptionPath);
      const hasText = fs.existsSync(textPath);
      const hasVtt = fs.existsSync(vttPath);

      if (!hasSegments && !hasText && !hasVtt) {
        return reply.code(404).send({ detail: "Transcription not found" });
      }

      let segments: { text: string }[] = [];
      let transcriptionText = "";

      if (hasSegments) {
        const raw = fs.readFileSync(transcriptionPath, "utf-8");
        segments = JSON.parse(raw) as { text: string }[];
        transcriptionText = segments
          .map((s) => s.text)
          .join(" ")
          .trim();
      } else if (hasText) {
        transcriptionText = fs.readFileSync(textPath, "utf-8").trim();
      }

      return {
        transcription: transcriptionText,
        segments,
        available_formats: {
          segments: hasSegments,
          text: hasText,
          vtt: hasVtt,
        },
      };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.delete<{ Params: { job_id: string } }>(
    "/:job_id/transcription",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const transcriptionPath = files.transcriptionPath(job_id);
        const textPath = files.transcriptionTextPath(job_id);
        const vttPath = files.transcriptionVttPath(job_id);

        let removed = false;
        if (fs.existsSync(transcriptionPath)) {
          fs.rmSync(transcriptionPath, { force: true });
          removed = true;
        }
        if (fs.existsSync(textPath)) {
          fs.rmSync(textPath, { force: true });
          removed = true;
        }
        if (fs.existsSync(vttPath)) {
          fs.rmSync(vttPath, { force: true });
          removed = true;
        }

        if (!removed) {
          return reply.code(404).send({ detail: "Transcription not found" });
        }

        try {
          const job = metadata.loadJob(job_id);
          job.status = JobStatus.DOWNLOADED;
          job.updated_at = new Date().toISOString();
          metadata.saveJob(job);
        } catch (error) {
          console.warn(`[jobs] Failed to update job status after transcription delete:`, error);
        }

        return {
          ok: true,
          job_id,
          available_formats: {
            segments: fs.existsSync(transcriptionPath),
            text: fs.existsSync(textPath),
            vtt: fs.existsSync(vttPath),
          },
        };
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  fastify.delete<{ Params: { job_id: string; format: string } }>(
    "/:job_id/transcription/:format",
    async (request, reply) => {
      try {
        const { job_id, format } = request.params;
        const transcriptionPath = files.transcriptionPath(job_id);
        const textPath = files.transcriptionTextPath(job_id);
        const vttPath = files.transcriptionVttPath(job_id);

        let removed = false;
        if (format === "segments") {
          if (fs.existsSync(transcriptionPath)) {
            fs.rmSync(transcriptionPath, { force: true });
            removed = true;
          }
        } else if (format === "text") {
          if (fs.existsSync(textPath)) {
            fs.rmSync(textPath, { force: true });
            removed = true;
          }
        } else if (format === "vtt") {
          if (fs.existsSync(vttPath)) {
            fs.rmSync(vttPath, { force: true });
            removed = true;
          }
        } else {
          return reply.code(400).send({ detail: "Invalid format" });
        }

        if (!removed) {
          return reply.code(404).send({ detail: "Transcription not found" });
        }

        if (format === "segments") {
          try {
            const job = metadata.loadJob(job_id);
            job.status = JobStatus.DOWNLOADED;
            job.updated_at = new Date().toISOString();
            metadata.saveJob(job);
          } catch (error) {
            console.warn(`[jobs] Failed to update job status after transcription delete:`, error);
          }
        }

        return {
          ok: true,
          job_id,
          available_formats: {
            segments: fs.existsSync(transcriptionPath),
            text: fs.existsSync(textPath),
            vtt: fs.existsSync(vttPath),
          },
        };
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  // Build blocks
  fastify.post<{ Params: { job_id: string } }>("/:job_id/blocks", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Building blocks for job: ${job_id}`);
      const blocks = semanticBlocks.buildSemanticBlocks(job_id);
      return blocks;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Analyze
  fastify.post<{ Params: { job_id: string } }>("/:job_id/analyze", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Analyzing job: ${job_id}`);
      const result = await analysis.analyzeBlocks(job_id);
      return result;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // List cuts
  fastify.get<{ Params: { job_id: string } }>("/:job_id/cuts", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Listing cuts for job: ${job_id}`);
      const cuts = curation.listSuggestions(job_id);
      return cuts;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Approve cut
  fastify.post<{ Params: { job_id: string; cut_id: string } }>(
    "/:job_id/cuts/:cut_id/approve",
    async (request, reply) => {
      try {
        const { job_id, cut_id } = request.params;
        console.log(`[jobs] Approving cut ${cut_id} for job ${job_id}`);
        const cut = curation.approveCut(job_id, cut_id);
        return cut;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  // Reject cut
  fastify.post<{ Params: { job_id: string; cut_id: string } }>(
    "/:job_id/cuts/:cut_id/reject",
    async (request, reply) => {
      try {
        const { job_id, cut_id } = request.params;
        console.log(`[jobs] Rejecting cut ${cut_id} for job ${job_id}`);
        const cut = curation.rejectCut(job_id, cut_id);
        return cut;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  // Render
  fastify.post<{ Params: { job_id: string } }>("/:job_id/render", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Rendering approved cuts for job: ${job_id}`);
      const outputs = rendering.renderSuggestedCuts(job_id);
      return outputs;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Run pipeline
  fastify.post<{ Params: { job_id: string }; Body: RunPipelineRequest }>(
    "/:job_id/run",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const body = request.body;
        const includeRender = body?.include_render ?? false;

        console.log(`[jobs] Running pipeline for job ${job_id} (include_render=${includeRender})`);
        const job = await orchestrator.runPipeline(job_id, { includeRender });
        return job;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
};

export default jobsRoutes;
