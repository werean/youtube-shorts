import type { Cut } from "../../models/cut";
import * as artifactService from "../../services/artifactService";

export function replaceCuts(jobId: string, cuts: Cut[]) {
  const cutsPath = artifactService.cutsPath(jobId);
  const cutsJson = JSON.stringify(cuts, null, 2);

  console.log("[jobs] Writing to:", cutsPath);
  console.log("[jobs] JSON string length:", cutsJson.length);

  artifactService.writeTextArtifact(cutsPath, cutsJson);

  return { ok: true, cuts };
}
