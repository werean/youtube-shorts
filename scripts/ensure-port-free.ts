import { execSync } from "child_process";

function parsePortArg(): number {
  const value = process.argv[2] || "8000";
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function getListeningPids(port: number): number[] {
  const output = execSync(`netstat -ano | findstr :${port}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();

  const pids = new Set<number>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/LISTENING/i.test(trimmed)) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function freePort(port: number): void {
  let pids: number[] = [];

  try {
    pids = getListeningPids(port);
  } catch {
    pids = [];
  }

  if (pids.length === 0) {
    console.log(`[dev] Porta ${port} disponível.`);
    return;
  }

  console.log(`[dev] Liberando porta ${port} (${pids.join(", ")})...`);

  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
      console.log(`[dev] Processo ${pid} encerrado.`);
    } catch (error) {
      console.warn(`[dev] Não foi possível encerrar PID ${pid}.`);
    }
  }
}

try {
  const port = parsePortArg();
  if (process.platform === "win32") {
    freePort(port);
  } else {
    console.log(`[dev] Script de liberação de porta está ativo apenas no Windows.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
