import type { PytorchGpuTier } from "../shared/dependencyTypes";

export function parsePytorchGpuTier(value: unknown): PytorchGpuTier | null {
  if (value === "rtx_4000_or_lower" || value === "rtx_5000") {
    return value;
  }
  return null;
}

export function expectedCudaPrefixForPytorchTier(tier: PytorchGpuTier): string {
  return tier === "rtx_5000" ? "12.8" : "12.1";
}

export function buildPytorchPipUninstallArgs(): string[] {
  return ["-m", "pip", "uninstall", "-y", "torch", "torchvision", "torchaudio"];
}

export function buildPytorchPipInstallArgs(tier: PytorchGpuTier): string[] {
  if (tier === "rtx_5000") {
    return [
      "-m",
      "pip",
      "install",
      "--pre",
      "torch",
      "torchvision",
      "torchaudio",
      "--index-url",
      "https://download.pytorch.org/whl/nightly/cu128",
    ];
  }

  return [
    "-m",
    "pip",
    "install",
    "torch",
    "torchvision",
    "torchaudio",
    "--index-url",
    "https://download.pytorch.org/whl/cu121",
  ];
}

export function buildPytorchCudaValidationArgs(expectedCudaPrefix: string): string[] {
  const code =
    "import torch, sys; " +
    `expected_prefix=${JSON.stringify(expectedCudaPrefix)}; ` +
    "cuda_version=getattr(getattr(torch,'version',None),'cuda',None); " +
    "cuda_available=bool(torch.cuda.is_available()); " +
    "print(f'torch.__version__={torch.__version__}'); " +
    "print(f'torch.version.cuda={cuda_version}'); " +
    "print(f'torch.cuda.is_available()={cuda_available}'); " +
    "sys.exit(0 if (cuda_available and cuda_version and str(cuda_version).startswith(expected_prefix)) else 1)";

  return ["-u", "-c", code];
}
