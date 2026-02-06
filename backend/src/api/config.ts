/**
 * API endpoints for configuration and system settings.
 */

import { FastifyPluginAsync } from "fastify";
import { SYSTEM_PROMPT_TEMPLATE } from "../llm/prompts";
import { execSync } from "child_process";
import { INSTALLATION_GUIDES } from "./installer";

interface DependencyStatus {
  installed: boolean;
  version: string | null;
}

function checkDependency(command: string, acceptStderr = false): DependencyStatus {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { installed: true, version: output || null };
  } catch (error: any) {
    // Para comandos como whisper --help que podem retornar saída em stderr
    if (acceptStderr) {
      const stderr = error.stderr ? error.stderr.toString().trim() : "";
      const stdout = error.stdout ? error.stdout.toString().trim() : "";

      // Se há output em stderr com informação de help/usage
      if (
        stderr &&
        (stderr.includes("usage:") || stderr.includes("--help") || stderr.length > 100)
      ) {
        return { installed: true, version: "OK" };
      }

      // Se há output em stdout
      if (stdout && stdout.length > 0) {
        return { installed: true, version: stdout };
      }
    }

    return { installed: false, version: null };
  }
}

function extractVersion(output: string, pattern?: RegExp): string {
  if (!pattern) return output;
  const match = output.match(pattern);
  return match ? match[1] : output;
}

const configRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/llm-prompt", async (request, reply) => {
    return {
      prompt: SYSTEM_PROMPT_TEMPLATE,
      version: "v1",
    };
  });

  fastify.get("/", async (request, reply) => {
    return {
      whisper: {
        device: process.env.WHISPER_DEVICE || "cpu",
        formats: process.env.WHISPER_FORMATS || "json,vtt,txt",
      },
      llm: {
        model: process.env.LLM_MODEL || "llama2",
      },
    };
  });

  fastify.get("/dependencies", async (request, reply) => {
    const pythonCheck = checkDependency("python --version");
    const whisperCheck = checkDependency("whisper --help", true);
    const ffmpegCheck = checkDependency("ffmpeg -version");
    const cudaCheck = checkDependency(
      "nvidia-smi --query-gpu=driver_version --format=csv,noheader",
    );
    const pytorchCheck = checkDependency('python -c "import torch; print(torch.__version__)"');

    // Check if Ollama is running
    let ollamaCheck = { installed: false, version: null };
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      if (response.ok) {
        ollamaCheck = { installed: true, version: "OK" };
      }
    } catch (error) {
      // Ollama not running
    }

    const dependencies = {
      python: {
        installed: pythonCheck.installed,
        version: pythonCheck.installed
          ? extractVersion(pythonCheck.version!, /Python\s+(\S+)/i)
          : null,
      },
      whisper: {
        installed: whisperCheck.installed,
        version: whisperCheck.installed ? "OK" : null,
      },
      ffmpeg: {
        installed: ffmpegCheck.installed,
        version: ffmpegCheck.installed
          ? extractVersion(ffmpegCheck.version!, /ffmpeg version (\S+)/i)
          : null,
      },
      cuda: {
        installed: cudaCheck.installed,
        version: cudaCheck.version,
      },
      pytorch: {
        installed: pytorchCheck.installed,
        version: pytorchCheck.version,
      },
      ollama: {
        installed: ollamaCheck.installed,
        version: ollamaCheck.version,
      },
    };

    return { dependencies };
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
    const guide = INSTALLATION_GUIDES[name];

    if (!guide || !guide.automatic) {
      return reply.status(400).send({
        error: "Automatic installation not available for this dependency",
        message: `Use manual installation for ${name}`,
      });
    }

    try {
      const output = execSync(guide.automatic.command, {
        encoding: "utf-8",
        timeout: 300000, // 5 minutos
        stdio: ["pipe", "pipe", "pipe"],
      });

      return {
        success: true,
        message: `${guide.name} installed successfully`,
        output: output.substring(0, 500), // Limita output
      };
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: `Failed to install ${guide.name}`,
        error: error.message,
        command: guide.automatic.command,
      });
    }
  });
};

export default configRoutes;
