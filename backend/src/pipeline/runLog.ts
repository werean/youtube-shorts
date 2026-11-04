/**
 * One JSON file per analysis or transcription run, stored in the job folder.
 * Secret-looking keys and credential strings are dropped before the write.
 */

import * as fs from "fs";
import * as path from "path";
import { redactSecrets } from "../llm/redact";
import * as artifactService from "../services/artifactService";

const SECRET_KEY = /api[_-]?key|authorization|token|secret|password|bearer|credential/i;

export function analysisRunLogPath(jobId: string): string {
  return path.join(path.dirname(artifactService.cutsPath(jobId)), "analysis.run.json");
}

export function transcriptionRunLogPath(jobId: string): string {
  return path.join(path.dirname(artifactService.cutsPath(jobId)), "transcription.run.json");
}

export function redactRunValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactRunValue(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) {
        continue;
      }
      output[key] = redactRunValue(item);
    }
    return output;
  }
  return value;
}

export function writeRunLog(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  artifactService.writeJsonArtifact(filePath, redactRunValue(value));
}
