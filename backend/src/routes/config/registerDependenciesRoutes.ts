/**
 * Register dependency status and install routes.
 */

import type { FastifyInstance } from "fastify";
import { INSTALLATION_GUIDES } from "../../features/dependencies/installationGuides";
import { snapshotDependencies } from "../../features/dependencies/detection/dependencyDetection";
import {
  performDependencyInstall,
  performDependencyUninstall,
} from "../../features/dependencies/execution/dependencyExecution";
import { parsePytorchGpuTier } from "../../features/dependencies/policy/pytorchPolicy";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import {
  getDependencyTerminalCommand,
  openSystemTerminal,
} from "../../features/dependencies/terminal/dependencyTerminal";
import type {
  DependencyInstallOptions,
  DependencyOperationMode,
} from "../../features/dependencies/shared/dependencyTypes";

const PYTORCH_GPU_TIER_REQUIRED_MESSAGE =
  "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.";

function buildDependencyInstallOptions(body: any): DependencyInstallOptions {
  const options: DependencyInstallOptions = {};
  const pytorchGpuTier = parsePytorchGpuTier(body?.pytorchGpuTier);
  if (pytorchGpuTier) {
    options.pytorchGpuTier = pytorchGpuTier;
  }
  return options;
}

function sendPytorchGpuTierRequired(reply: any) {
  return reply.status(400).send({
    success: false,
    message: PYTORCH_GPU_TIER_REQUIRED_MESSAGE,
  });
}

function sendMissingInstallSession(reply: any, sessionId: string) {
  return reply.status(404).send({
    success: false,
    message: `Install session '${sessionId}' was not found`,
  });
}

export function registerDependenciesRoutes(fastify: FastifyInstance) {
  fastify.get("/dependencies", async () => {
    const snapshot = await snapshotDependencies();
    return {
      dependencies: snapshot.checks,
      diagnostics: snapshot.diagnostics,
    };
  });

  fastify.get("/dependencies/:name/instructions", async (request: any, reply) => {
    const { name } = request.params;
    const guide = INSTALLATION_GUIDES[name];

    if (!guide) {
      return reply.status(404).send({ error: "Dependency not found" });
    }

    return guide;
  });

  fastify.post("/dependencies/:name/install", async (request: any, reply) => {
    const { name } = request.params;

    const options = buildDependencyInstallOptions(request.body);

    if (name === "pytorch" && !options.pytorchGpuTier) {
      return sendPytorchGpuTierRequired(reply);
    }

    const result = await performDependencyInstall(name, undefined, undefined, options);
    return reply.status(result.statusCode).send(result.payload);
  });

  fastify.post("/dependencies/:name/uninstall", async (request: any, reply) => {
    const { name } = request.params;
    const result = await performDependencyUninstall(name);
    return reply.status(result.statusCode).send(result.payload);
  });

  fastify.post("/dependencies/:name/install/start", async (request: any, reply) => {
    await operationRuntimeService.cleanupInstallSessions();

    const { name } = request.params;

    const options = buildDependencyInstallOptions(request.body);

    if (name === "pytorch" && !options.pytorchGpuTier) {
      return sendPytorchGpuTierRequired(reply);
    }

    return reply
      .status(202)
      .send(await operationRuntimeService.startDependencyInstallSession(name, options));
  });

  fastify.post("/dependencies/:name/uninstall/start", async (request: any, reply) => {
    await operationRuntimeService.cleanupInstallSessions();

    const { name } = request.params;
    return reply
      .status(202)
      .send(await operationRuntimeService.startDependencyUninstallSession(name));
  });

  fastify.get("/dependencies/install-sessions/:sessionId", async (request: any, reply) => {
    await operationRuntimeService.cleanupInstallSessions();

    const { sessionId } = request.params;
    const session = await operationRuntimeService.getDependencyInstallSessionPayload(sessionId);

    if (!session) {
      return sendMissingInstallSession(reply, sessionId);
    }

    return session;
  });

  fastify.post("/dependencies/install-sessions/:sessionId/cancel", async (request: any, reply) => {
    await operationRuntimeService.cleanupInstallSessions();

    const { sessionId } = request.params;
    const result = await operationRuntimeService.cancelDependencyInstallSession(sessionId);

    return reply.status(result.statusCode).send(result.payload);
  });

  fastify.post("/dependencies/:name/open-terminal", async (request: any, reply) => {
    const { name } = request.params;
    const mode: DependencyOperationMode =
      request.body && request.body.mode === "uninstall" ? "uninstall" : "install";

    const options = buildDependencyInstallOptions(request.body);

    if (name === "pytorch" && mode === "install" && !options.pytorchGpuTier) {
      return sendPytorchGpuTierRequired(reply);
    }

    const command = await getDependencyTerminalCommand(name, mode, options);

    if (!command) {
      return reply.status(400).send({
        success: false,
        message: `No terminal command available for ${name} (${mode})`,
      });
    }

    const opened = openSystemTerminal(command);
    if (!opened.success) {
      return reply.status(500).send({
        success: false,
        message: opened.error || "Failed to open terminal",
        command,
      });
    }

    return {
      success: true,
      message: `Opened the default system terminal with the ${mode} command.`,
      command,
    };
  });
}
