export class PipelineCancelledError extends Error {
  constructor(message = "Pipeline cancelled") {
    super(message);
    this.name = "PipelineCancelledError";
  }
}

export class NoApprovedCutsError extends Error {
  constructor(message = "No approved cuts to render") {
    super(message);
    this.name = "NoApprovedCutsError";
  }
}
