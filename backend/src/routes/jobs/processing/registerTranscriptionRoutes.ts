/**
 * Register transcription routes.
 */

import type { FastifyInstance } from "fastify";
import * as transcription from "../../../pipeline/transcription";
import {
  buildTranscriptionResponseFromSegments,
  deleteAllTranscriptionArtifacts,
  deleteTranscriptionFormat,
  readTranscriptionResponse,
} from "../../../features/jobs/transcriptionArtifacts";

export function registerTranscriptionRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/transcribe", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Transcribing job: ${job_id}`);
      const segments = await transcription.transcribeJob(job_id);

      return buildTranscriptionResponseFromSegments(job_id, segments);
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
      const response = readTranscriptionResponse(job_id);
      if (!response) {
        return reply.code(404).send({ detail: "Transcription not found" });
      }

      return response;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.delete<{ Params: { job_id: string } }>(
    "/:job_id/transcription",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const result = deleteAllTranscriptionArtifacts(job_id);
        if (!result.deleted) {
          return reply.code(404).send({ detail: "Transcription not found" });
        }

        return result.response;
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
        const result = deleteTranscriptionFormat(job_id, format);
        if (result.status === "invalid-format") {
          return reply.code(400).send({ detail: "Invalid format" });
        }

        if (result.status === "not-found") {
          return reply.code(404).send({ detail: "Transcription not found" });
        }

        return result.response;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
