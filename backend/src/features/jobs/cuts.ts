import * as fs from "fs";

import type { Cut } from "../../models/cut";
import * as files from "../../storage/files";

export function replaceCuts(jobId: string, cuts: Cut[]) {
  const cutsPath = files.cutsPath(jobId);
  const cutsJson = JSON.stringify(cuts, null, 2);

  console.log("[jobs] Writing to:", cutsPath);
  console.log("[jobs] JSON string length:", cutsJson.length);

  fs.writeFileSync(cutsPath, cutsJson, "utf-8");

  return { ok: true, cuts };
}
