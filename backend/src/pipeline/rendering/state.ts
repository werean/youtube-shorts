import { spawn, type ChildProcess } from "child_process";

const activeRenderings = new Map<string, Set<ChildProcess>>();
const cancelledRenderings = new Set<string>();

export function conflictingActiveRenderingJobId(jobId: string): string | null {
  if (activeRenderings.size === 0 || activeRenderings.has(jobId)) {
    return null;
  }

  return Array.from(activeRenderings.keys())[0] || null;
}

export function isRenderingCancelled(jobId: string): boolean {
  return cancelledRenderings.has(jobId);
}

export function trackChildProcess(jobId: string, child: ChildProcess): void {
  let children = activeRenderings.get(jobId);
  if (!children) {
    children = new Set<ChildProcess>();
    activeRenderings.set(jobId, children);
  }

  children.add(child);

  child.once("exit", () => {
    const running = activeRenderings.get(jobId);
    if (!running) {
      return;
    }
    running.delete(child);
    if (running.size === 0) {
      activeRenderings.delete(jobId);
    }
  });
}

function stopChildProcess(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    return;
  }

  child.kill("SIGTERM");
}

export function cancelActiveRendering(jobId: string, onCancelRequested: () => void): boolean {
  const children = activeRenderings.get(jobId);
  if (!children || children.size === 0) {
    return false;
  }

  onCancelRequested();
  cancelledRenderings.add(jobId);

  try {
    for (const child of children) {
      stopChildProcess(child);
    }
  } catch (error) {
    console.error(`[rendering] Failed to cancel process for job ${jobId}:`, error);
  }

  activeRenderings.delete(jobId);
  return true;
}

export function cleanupRenderingState(jobId: string): void {
  activeRenderings.delete(jobId);
  cancelledRenderings.delete(jobId);
}
