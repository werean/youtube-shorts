/**
 * Register core Fastify plugins and static serving.
 */

import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import multipart from "@fastify/multipart";
import { archivedDir, dataDir, uploadDir } from "../core/paths";

export async function registerPlugins(fastify: FastifyInstance) {
  await fastify.register(cors, {
    origin: true,
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024 * 1024,
    },
  });

  await fastify.register(staticPlugin, {
    root: uploadDir(),
    prefix: "/upload",
  });

  await fastify.register(staticPlugin, {
    root: dataDir(),
    prefix: "/data",
    decorateReply: false,
  });

  await fastify.register(staticPlugin, {
    root: archivedDir(),
    prefix: "/arquivados",
    decorateReply: false,
  });

  fastify.addHook("onRequest", async (request) => {
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
}
