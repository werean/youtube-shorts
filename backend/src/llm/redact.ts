/** Drop credential-shaped text before it reaches logs or error messages. */

export function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(api[_-]?key|authorization|token|secret|password)\s*[:=]\s*["']?[^"'\s,}]+/gi,
      "$1=[redacted]",
    );
}
