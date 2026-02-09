/**
 * Register transcription routes.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "fs";
import { JobStatus } from "../../models/job";
import * as files from "../../storage/files";
import * as metadata from "../../storage/metadata";
import * as transcription from "../../pipeline/transcription";

export function registerTranscriptionRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/transcribe", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Transcribing job: ${job_id}`);
      const segments = await transcription.transcribeJob(job_id);

      const formats = {
        text: fs.existsSync(files.transcriptionTextPath(job_id)),
        vtt: fs.existsSync(files.transcriptionVttPath(job_id)),
      };

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

  fastify.post<{ Params: { job_id: string } }>(
    "/:job_id/transcribe/cancel",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const cancelled = transcription.cancelTranscription(job_id);
        if (!cancelled) {
          return reply.code(404).send({ detail: "Transcription not running" });
        }
        return { ok: true, job_id };
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

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
}
