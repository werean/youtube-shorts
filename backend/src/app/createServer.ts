/**
 * Create and configure the Fastify instance.
 */

import Fastify from "fastify";

export function createServer() {
  return Fastify({
    logger: false,
  });
}
