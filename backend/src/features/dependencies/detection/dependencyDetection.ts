import type { DependencyChecks, DependencySnapshot } from "../shared/dependencyTypes";
import {
  detectCuda,
  detectFFmpeg,
  detectOllama,
  detectPyTorch,
  detectWhisper,
  detectYtDlp,
} from "./dependencyProbes";
import { detectPythonRuntime } from "./pythonRuntime";

export async function snapshotDependencies(): Promise<DependencySnapshot> {
  const diagnostics: string[] = [];
  const pythonDetection = detectPythonRuntime(diagnostics);

  const checks: DependencyChecks = {
    python: pythonDetection.status,
    whisper: detectWhisper(pythonDetection.runtime, diagnostics),
    ytdlp: detectYtDlp(pythonDetection.runtime, diagnostics),
    ffmpeg: detectFFmpeg(),
    cuda: detectCuda(),
    pytorch: detectPyTorch(pythonDetection.runtime),
    ollama: await detectOllama(),
  };

  return {
    checks,
    pythonRuntime: pythonDetection.runtime,
    diagnostics,
  };
}
