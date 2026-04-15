import { execSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = resolve(rootDir, "backend");
const port = 8000;

function isPortListening(targetPort: number): boolean {
  try {
    const output = execSync(`netstat -ano | findstr :${targetPort}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();

    return output
      .split(/\r?\n/)
      .some((line) => /LISTENING/i.test(line) && line.includes(`:${targetPort}`));
  } catch {
    return false;
  }
}

function getPortListeningLines(targetPort: number): string[] {
  try {
    const output = execSync(`netstat -ano | findstr :${targetPort}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) => line.length > 0 && /LISTENING/i.test(line) && line.includes(`:${targetPort}`),
      );
  } catch {
    return [];
  }
}

function extractPidsFromNetstatLines(lines: string[]): string[] {
  const pids = new Set<string>();
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

async function isHealthyBackendRunning(targetPort: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);

  try {
    const res = await fetch(`http://localhost:${targetPort}/health`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!res.ok) {
      return false;
    }

    const data = (await res.json().catch(() => null)) as any;
    return Boolean(data && data.status === "ok");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

if (process.platform === "win32" && isPortListening(port)) {
  const isHealthy = await isHealthyBackendRunning(port);

  if (isHealthy) {
    console.log(
      `[dev] Porta ${port} já está em uso e /health respondeu OK. Assumindo backend existente e não iniciando outro servidor.`,
    );
    process.exit(0);
  }

  const listeningLines = getPortListeningLines(port);
  const pids = extractPidsFromNetstatLines(listeningLines);

  console.error(`[dev] Porta ${port} já está em uso, mas o backend não respondeu OK em /health.`);
  if (pids.length > 0) {
    console.error(`[dev] PID(s) na porta ${port}: ${pids.join(", ")}`);
    console.error(`[dev] Dica: finalize com: taskkill /PID <pid> /F`);
  }
  if (listeningLines.length > 0) {
    console.error("[dev] netstat (LISTENING):");
    for (const line of listeningLines) {
      console.error(`  ${line}`);
    }
  }

  process.exit(1);
}

const child = Bun.spawn(["bun", "run", "--watch", "src/main.ts"], {
  cwd: backendDir,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await child.exited;
process.exit(exitCode);
