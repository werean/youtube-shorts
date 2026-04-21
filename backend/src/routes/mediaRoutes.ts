/**
 * Media streaming endpoints for local video and short files.
 */

import type { FastifyPluginAsync } from "fastify";
import {
  resolveShortVideoPath,
  resolveSourceVideoPath,
  sendVideoStream,
} from "../features/media/streaming";

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { job_id: string } }>("/media/videos/:job_id", async (request, reply) => {
    try {
      const { job_id } = request.params;
      const result = resolveSourceVideoPath(job_id);
      if (!result.ok) {
        return reply.code(404).send({ detail: result.detail });
      }
      await sendVideoStream(request, reply, result.filePath);
    } catch (error: any) {
      console.error(`[media] ✗ Erro ao servir vídeo:`, error.message);
      return reply.code(500).send({ detail: error.message });
    }
  });

  fastify.get<{ Params: { job_id: string; file: string } }>(
    "/media/shorts/:job_id/:file",
    async (request, reply) => {
      try {
        const { job_id, file } = request.params;
        const result = resolveShortVideoPath(job_id, file);
        if (!result.ok) {
          return reply.code(404).send({ detail: result.detail });
        }
        await sendVideoStream(request, reply, result.filePath);
      } catch (error: any) {
        return reply.code(500).send({ detail: error.message });
      }
    },
  );
};

export default mediaRoutes;
