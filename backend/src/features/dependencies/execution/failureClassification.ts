export function detectFailureCategory(output: string): string {
  const text = output.toLowerCase();

  if (
    text.includes("access is denied") ||
    text.includes("administrator") ||
    text.includes("eacces") ||
    text.includes("permission")
  ) {
    return "permission-error";
  }

  if (
    text.includes("conflict") ||
    text.includes("resolutionimpossible") ||
    text.includes("incompatible")
  ) {
    return "version-conflict";
  }

  if (text.includes("not recognized") || text.includes("enoent") || text.includes("path")) {
    return "path-env-error";
  }

  return "install-failed";
}
