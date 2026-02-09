/**
 * Job routes entrypoint.
 */

import type { FastifyPluginAsync } from "fastify";
import { registerCreateJobRoutes } from "./registerCreateJob";
import { registerUploadJobRoutes } from "./registerUploadJob";
import { registerGetJobRoutes } from "./registerGetJob";
import { registerIngestJobRoutes } from "./registerIngestJob";
import { registerTranscriptionRoutes } from "./registerTranscriptionRoutes";
import { registerBlocksRoutes } from "./registerBlocksRoutes";
import { registerAnalysisRoutes } from "./registerAnalysisRoutes";
import { registerCutsRoutes } from "./registerCutsRoutes";
import { registerRenderRoutes } from "./registerRenderRoutes";
import { registerPipelineRoutes } from "./registerPipelineRoutes";
import { registerBatchPipelineRoutes } from "./registerBatchPipelineRoutes";
import { registerRenameRoutes } from "./registerRenameRoutes";
import { registerLogsRoutes } from "./registerLogsRoutes";

const jobsRoutes: FastifyPluginAsync = async (fastify) => {
  registerCreateJobRoutes(fastify);
  registerUploadJobRoutes(fastify);
  registerGetJobRoutes(fastify);
  registerIngestJobRoutes(fastify);
  registerTranscriptionRoutes(fastify);
  registerBlocksRoutes(fastify);
  registerAnalysisRoutes(fastify);
  registerCutsRoutes(fastify);
  registerRenderRoutes(fastify);
  registerPipelineRoutes(fastify);
  registerBatchPipelineRoutes(fastify);
  registerRenameRoutes(fastify);
  registerLogsRoutes(fastify);
};

export default jobsRoutes;
