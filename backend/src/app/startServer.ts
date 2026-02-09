/**
 * Server startup and boot logs.
 */

import * as fs from "fs";
import * as path from "path";
import { uploadDir } from "../core/paths";
import { createServer } from "./createServer";
import { registerPlugins } from "./registerPlugins";
import { registerRoutes } from "./registerRoutes";

export async function startServer() {
  const fastify = createServer();
  const port = Number(process.env.PORT) || 8000;

  await registerPlugins(fastify);
  await registerRoutes(fastify);

  try {
    console.log(`[app] Inicializando servidor Fastify na porta ${port}...`);
    await fastify.listen({ port, host: "0.0.0.0" });
    console.log(`[app] ✓ Server running on http://localhost:${port}`);
    console.log(`[app] ✓ YouTube Shorts MVP - TypeScript Backend`);
    console.log(`[app] ✓ CORS habilitado para todas as origins`);
    console.log(`[app] Health check: http://localhost:${port}/health`);

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
  } catch (error) {
    console.error(`[app] ✗ Erro ao iniciar servidor:`, error);
    process.exit(1);
  }

  return fastify;
}
