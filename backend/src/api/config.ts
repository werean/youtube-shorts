/**
 * API endpoints for configuration and system settings.
 */

import { FastifyPluginAsync } from "fastify";
import { SYSTEM_PROMPT_TEMPLATE } from "../llm/prompts";
import { execSync } from "child_process";
import { INSTALLATION_GUIDES } from "./installer";
import { loadSettings, updateSettings } from "../core/settings";
import type { AppSettings } from "../core/settings";
import { homedir } from "os";
import * as fs from "fs";
import * as path from "path";

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
    const settings = loadSettings();
    return {
      whisper: {
        device: settings.whisper.device,
        formats: settings.whisper.formats.join(","),
      },
      llm: {
        model: settings.llm.model,
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

  // Get user settings
  fastify.get("/settings", async (request, reply) => {
    try {
      const settings = loadSettings();
      return settings;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Update user settings
  fastify.post("/settings", async (request: any, reply) => {
    try {
      const body = request.body as Partial<AppSettings>;
      console.log(`[config] Atualizando settings:`, body);

      // Validate base_dir if provided
      if (body.media?.base_dir) {
        const baseDir = body.media.base_dir;

        // Check if path exists or can be created
        if (!fs.existsSync(baseDir)) {
          console.log(`[config] Criando diretório: ${baseDir}`);
          fs.mkdirSync(baseDir, { recursive: true });
        }
      }

      const updatedSettings = updateSettings(body);
      console.log(`[config] ✓ Settings atualizadas`);
      return updatedSettings;
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao atualizar settings:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });

  // Get common user folders
  fastify.get("/common-folders", async (request, reply) => {
    try {
      const home = homedir();
      const folders: { name: string; path: string; exists: boolean }[] = [
        {
          name: "📥 Downloads",
          path: path.join(home, "Downloads"),
          exists: false,
        },
        {
          name: "📄 Documentos",
          path: path.join(home, "Documents"),
          exists: false,
        },
        {
          name: "🏠 Home",
          path: home,
          exists: false,
        },
        {
          name: "🖥️ Desktop",
          path: path.join(home, "Desktop"),
          exists: false,
        },
      ];

      // Check which folders exist
      folders.forEach((folder) => {
        folder.exists = fs.existsSync(folder.path);
      });

      return { folders };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  // Open folder picker dialog
  fastify.post("/select-folder", async (request, reply) => {
    try {
      console.log(`[config] Abrindo seletor de pasta...`);

      // PowerShell script using Shell.Application for modern folder picker
      const psScript = `
$shell = New-Object -ComObject Shell.Application;
$folder = $shell.BrowseForFolder(0, 'Selecione a pasta para armazenar os arquivos', 0x200, 0);
if ($folder -ne $null) {
    $folderPath = $folder.Self.Path;
    Write-Output $folderPath
}
      `.trim();

      // Encode to base64 to avoid escaping issues
      const encodedScript = Buffer.from(psScript, "utf16le").toString("base64");

      const output = execSync(`powershell -NoProfile -EncodedCommand ${encodedScript}`, {
        encoding: "utf-8",
        timeout: 60000, // 1 minute timeout
        windowsHide: false,
      }).trim();

      console.log(`[config] Pasta selecionada: ${output}`);

      if (!output) {
        return { selected: false, path: null };
      }

      return { selected: true, path: output };
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao abrir seletor de pasta:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });
};

export default configRoutes;
