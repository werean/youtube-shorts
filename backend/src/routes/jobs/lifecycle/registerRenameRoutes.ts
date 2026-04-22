/**
 * Register rename routes.
 */

import type { FastifyInstance } from "fastify";
import { renameJobVideo } from "../../../features/jobs/rename";
import {
  parseRenameJobRequest,
  type ErrorDetailResponseDto,
  type JobIdParamsDto,
  type RenameJobRequestDto,
} from "../../contracts/jobContracts";
import type { Job } from "../../../models/job";

export function registerRenameRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Params: JobIdParamsDto;
    Body: RenameJobRequestDto;
    Reply: Job | ErrorDetailResponseDto;
  }>(
    "/:job_id/rename",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const parsed = parseRenameJobRequest(request.body);
        const newName = parsed.newName;

        if (!newName) {
          return reply.code(400).send({ detail: "new_name is required" });
        }

        const job = renameJobVideo(job_id, newName);
        if (!job) {
          return reply.code(500).send({ detail: "Failed to rename video" });
        }

        return job;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
