import * as childProcess from "child_process";

let cachedGpu: boolean | null = null;

/**
 * Local GPU is the default runtime. CPU is used only when the caller asks for it
 * or this machine has no NVIDIA GPU.
 */
export function hasLocalGpu(): boolean {
  if (process.env.YOUTUBE_SHORTS_FORCE_CPU === "1") {
    return false;
  }
  if (process.env.YOUTUBE_SHORTS_FORCE_GPU === "1") {
    return true;
  }
  if (cachedGpu !== null) {
    return cachedGpu;
  }

  if (typeof childProcess.execFileSync !== "function") {
    cachedGpu = false;
    return false;
  }

  try {
    childProcess.execFileSync("nvidia-smi", ["-L"], { stdio: "ignore", timeout: 2000 });
    cachedGpu = true;
  } catch {
    cachedGpu = false;
  }
  return cachedGpu;
}

export function resolveModelDevice(requested: string | undefined): "cpu" | "cuda" {
  if (requested === "cpu") {
    return "cpu";
  }
  return hasLocalGpu() ? "cuda" : "cpu";
}
