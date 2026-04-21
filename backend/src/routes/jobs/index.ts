/**
 * Job routes entrypoint.
 */

import type { FastifyPluginAsync } from "fastify";
import { registerCreateJobRoutes } from "./lifecycle/registerCreateJob";
import { registerUploadJobRoutes } from "./lifecycle/registerUploadJob";
import { registerGetJobRoutes } from "./lifecycle/registerGetJob";
import { registerIngestJobRoutes } from "./lifecycle/registerIngestJob";
import { registerRenameRoutes } from "./lifecycle/registerRenameRoutes";
import { registerLogsRoutes } from "./lifecycle/registerLogsRoutes";
import { registerTranscriptionRoutes } from "./processing/registerTranscriptionRoutes";
import { registerBlocksRoutes } from "./processing/registerBlocksRoutes";
import { registerAnalysisRoutes } from "./processing/registerAnalysisRoutes";
import { registerPipelineRoutes } from "./processing/registerPipelineRoutes";
import { registerBatchPipelineRoutes } from "./processing/registerBatchPipelineRoutes";
import { registerCutsRoutes } from "./curation/registerCutsRoutes";
import { registerRenderRoutes } from "./rendering/registerRenderRoutes";

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
