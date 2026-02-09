/**
 * API endpoints for configuration and system settings.
 */

import { FastifyPluginAsync } from "fastify";
import { registerPromptRoutes } from "./config/registerPromptRoutes";
import { registerConfigInfoRoutes } from "./config/registerConfigInfoRoutes";
import { registerDependenciesRoutes } from "./config/registerDependenciesRoutes";
import { registerSettingsRoutes } from "./config/registerSettingsRoutes";
import { registerCommonFoldersRoutes } from "./config/registerCommonFoldersRoutes";
import { registerFolderPickerRoutes } from "./config/registerFolderPickerRoutes";
import { registerToolConfigsRoutes } from "./config/registerToolConfigsRoutes";

const configRoutes: FastifyPluginAsync = async (fastify) => {
  registerPromptRoutes(fastify);
  registerConfigInfoRoutes(fastify);
  registerDependenciesRoutes(fastify);
  registerSettingsRoutes(fastify);
  registerToolConfigsRoutes(fastify);
  registerCommonFoldersRoutes(fastify);
  registerFolderPickerRoutes(fastify);
};

export default configRoutes;
