/**
 * Video library endpoints for upload and archive management.
 */

import type { FastifyPluginAsync } from "fastify";
import {
  archiveVideo,
  deleteVideo,
  listActiveVideos,
  listArchivedVideos,
  openVideoFolder,
} from "../features/videos/library";

const videosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/videos", async () => {
    return listActiveVideos();
  });

  fastify.get("/videos/archived", async () => {
    return listArchivedVideos();
  });

  fastify.post<{ Params: { job_id: string } }>(
    "/videos/:job_id/archive",
    async (request, reply) => {
      const { job_id } = request.params;
      const result = archiveVideo(job_id);
      if (!result.ok) {
        return reply.code(404).send({ detail: "Video not found" });
      }

      return result;
    },
  );

  fastify.delete<{ Params: { job_id: string } }>("/videos/:job_id", async (request, reply) => {
    const { job_id } = request.params;
    const result = deleteVideo(job_id);
    if (!result.ok) {
      return reply.code(404).send({ detail: "Video not found" });
    }

    return result;
  });

  fastify.post<{ Params: { job_id: string } }>(
    "/videos/:job_id/open-folder",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const result = openVideoFolder(job_id);
        if (!result.ok) {
          return reply.code(result.statusCode).send({ detail: result.detail });
        }

        return { ok: true };
      } catch (error: any) {
        return reply.code(500).send({ detail: error.message });
      }
    },
  );
};

export default videosRoutes;
