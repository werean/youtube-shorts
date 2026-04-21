import { MAX_SESSION_LOG_LINES } from "./dependencyTypes";
import type { DependencyInstallSession } from "./dependencyTypes";

export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function nowLogStamp(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function appendSessionLog(session: DependencyInstallSession, message: string) {
  const lines = message
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  for (const line of lines) {
    session.logs.push(`[${nowLogStamp()}] ${line}`);
  }

  if (session.logs.length > MAX_SESSION_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_SESSION_LOG_LINES);
  }
}
