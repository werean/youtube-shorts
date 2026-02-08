/**
 * Fastify application entrypoint.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import multipart from "@fastify/multipart";
import { archivedDir, dataDir, uploadDir } from "./core/paths";
import healthRoutes from "./api/health";
import jobsRoutes from "./api/jobs";
import videosRoutes from "./api/videos";
import mediaRoutes from "./api/media";
import configRoutes from "./api/config";
import mediaRoutes from "./api/media";
import * as fs from "fs";
import * as path from "path";

const fastify = Fastify({
  logger: false,
});

const PORT = Number(process.env.PORT) || 8000;

// Register CORS
fastify.register(cors, {
  origin: true, // Allow all origins in development
});

// Register multipart for file uploads
fastify.register(multipart, {
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
  },
});

// Register static file serving for uploaded videos
fastify.register(staticPlugin, {
  root: uploadDir(),
  prefix: "/upload",
});

fastify.register(staticPlugin, {
  root: dataDir(),
  prefix: "/data",
  decorateReply: false,
});

fastify.register(staticPlugin, {
  root: archivedDir(),
  prefix: "/arquivados",
  decorateReply: false,
});

// Register routes
fastify.register(healthRoutes);
fastify.register(jobsRoutes, { prefix: "/jobs" });
fastify.register(videosRoutes);
fastify.register(mediaRoutes);
fastify.register(configRoutes, { prefix: "/config" });

// Hook para logar todas as requisições
fastify.addHook("onRequest", async (request, reply) => {
  if (
    request.url.startsWith("/upload") ||
    request.url.startsWith("/arquivados") ||
    request.url.startsWith("/data")
  ) {
    console.log(`\n[static] 📁 Requisição de arquivo estático:`);
    console.log(`[static]   URL: ${request.url}`);
    console.log(`[static]   Method: ${request.method}`);
  }
});

// Hook para logar respostas de arquivos estáticos
fastify.addHook("onSend", async (request, reply, payload) => {
  if (
    request.url.startsWith("/upload") ||
    request.url.startsWith("/arquivados") ||
    request.url.startsWith("/data")
  ) {
    console.log(`[static] ✓ Respondendo:`);
    console.log(`[static]   Status: ${reply.statusCode}`);
    console.log(`[static]   Content-Type: ${reply.getHeader("content-type")}`);
  }
  return payload;
});

// Start server
const start = async () => {
  try {
    console.log(`[app] Inicializando servidor Fastify na porta ${PORT}...`);
    await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`[app] ✓ Server running on http://localhost:${PORT}`);
    console.log(`[app] ✓ YouTube Shorts MVP - TypeScript Backend`);
    console.log(`[app] ✓ CORS habilitado para todas as origins`);
    console.log(`[app] Health check: http://localhost:${PORT}/health`);

    // Listar arquivos no diretório upload
    console.log(`\n[app] 📂 Verificando diretório upload:`);
    const uploadPath = uploadDir();
    console.log(`[app]   Path: ${uploadPath}`);
    if (fs.existsSync(uploadPath)) {
      const jobs = fs.readdirSync(uploadPath);
      console.log(`[app]   Jobs encontrados: ${jobs.length}`);
      jobs.forEach((jobId) => {
        const jobPath = path.join(uploadPath, jobId);
        if (fs.statSync(jobPath).isDirectory()) {
          const files = fs.readdirSync(jobPath);
          console.log(`[app]   ├─ ${jobId}/`);
          files.forEach((file) => {
            const filePath = path.join(jobPath, file);
            const stats = fs.statSync(filePath);
            console.log(`[app]   │  └─ ${file} (${stats.size} bytes)`);
          });
        }
      });
    } else {
      console.log(`[app]   ⚠ Diretório não existe ainda`);
    }
    console.log(`\n`);
  } catch (err) {
    console.error(`[app] ✗ Erro ao iniciar servidor:`, err);
    process.exit(1);
  }
};

start();

export default fastify;
