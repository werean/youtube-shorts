import * as artifactService from "../../services/artifactService";

export function collectOrderedOutputs(orderedOutputs: string[]): string[] {
  const outputs: string[] = [];
  for (const output of orderedOutputs) {
    if (output) {
      outputs.push(output);
    }
  }
  return outputs;
}

export function listRenderOutputs(jobId: string): string[] {
  return artifactService.listRenderOutputUrls(jobId);
}
