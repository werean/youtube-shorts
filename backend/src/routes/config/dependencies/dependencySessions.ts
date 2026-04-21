import { randomUUID } from "crypto";
import { MAX_SESSION_LOG_LINES, SESSION_TTL_MS } from "./dependencyTypes";
import { performDependencyInstall, performDependencyUninstall } from "./dependencyExecution";
import type {
  DependencyInstallOptions,
  DependencyInstallSession,
  DependencySessionControl,
} from "./dependencyTypes";

const dependencyInstallSessions = new Map<string, DependencyInstallSession>();
const dependencySessionControls = new Map<string, DependencySessionControl>();

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function nowLogStamp(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function appendSessionLog(session: DependencyInstallSession, message: string) {
  const lines = message
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  for (const line of lines) {
    session.logs.push(`[${nowLogStamp()}] ${line}`);
  }

  if (session.logs.length > MAX_SESSION_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_SESSION_LOG_LINES);
  }
}

export function cleanupInstallSessions() {
  const now = Date.now();
  for (const [sessionId, session] of dependencyInstallSessions.entries()) {
    const referenceTime = session.endedAt
      ? Date.parse(session.endedAt)
      : Date.parse(session.startedAt);
    if (Number.isFinite(referenceTime) && now - referenceTime > SESSION_TTL_MS) {
      dependencyInstallSessions.delete(sessionId);
      dependencySessionControls.delete(sessionId);
    }
  }
}

export function startDependencyInstallSession(
  name: string,
  options: DependencyInstallOptions,
) {
  const sessionId = randomUUID();
  const session: DependencyInstallSession = {
    id: sessionId,
    operation: "install",
    dependencyName: name,
    status: "running",
    startedAt: nowIsoTimestamp(),
    logs: [],
  };

  const sessionControl: DependencySessionControl = {
    cancelRequested: false,
    currentChild: null,
  };

  dependencyInstallSessions.set(sessionId, session);
  dependencySessionControls.set(sessionId, sessionControl);
  appendSessionLog(session, `Install session created for ${name}.`);

  void (async () => {
    try {
      const result = await performDependencyInstall(
        name,
        (line) => appendSessionLog(session, line),
        sessionControl,
        options,
      );
      session.result = result.payload;
      session.status = sessionControl.cancelRequested
        ? "cancelled"
        : result.payload.success
          ? "success"
          : "failed";
      session.endedAt = nowIsoTimestamp();
      appendSessionLog(
        session,
        session.status === "cancelled"
          ? `Installation cancelled for ${name}.`
          : result.payload.success
            ? `Installation finished successfully for ${name}.`
            : `Installation finished with errors for ${name}.`,
      );
    } catch (error: any) {
      session.result = {
        success: false,
        message: `Failed to install ${name}`,
        error: error?.message || "Unexpected install session error",
      };
      session.status = "failed";
      session.endedAt = nowIsoTimestamp();
      appendSessionLog(session, `Unexpected install session error: ${session.result.error}`);
    } finally {
      sessionControl.currentChild = null;
      dependencySessionControls.delete(sessionId);
    }
  })();

  return {
    sessionId,
    operation: session.operation,
    dependencyName: name,
    status: session.status,
    startedAt: session.startedAt,
  };
}

export function startDependencyUninstallSession(name: string) {
  const sessionId = randomUUID();
  const session: DependencyInstallSession = {
    id: sessionId,
    operation: "uninstall",
    dependencyName: name,
    status: "running",
    startedAt: nowIsoTimestamp(),
    logs: [],
  };

  const sessionControl: DependencySessionControl = {
    cancelRequested: false,
    currentChild: null,
  };

  dependencyInstallSessions.set(sessionId, session);
  dependencySessionControls.set(sessionId, sessionControl);
  appendSessionLog(session, `Uninstall session created for ${name}.`);

  void (async () => {
    try {
      const result = await performDependencyUninstall(
        name,
        (line) => appendSessionLog(session, line),
        sessionControl,
      );
      session.result = result.payload;
      session.status = sessionControl.cancelRequested
        ? "cancelled"
        : result.payload.success
          ? "success"
          : "failed";
      session.endedAt = nowIsoTimestamp();
      appendSessionLog(
        session,
        session.status === "cancelled"
          ? `Uninstall cancelled for ${name}.`
          : result.payload.success
            ? `Uninstall finished successfully for ${name}.`
            : `Uninstall finished with errors for ${name}.`,
      );
    } catch (error: any) {
      session.result = {
        success: false,
        message: `Failed to uninstall ${name}`,
        error: error?.message || "Unexpected uninstall session error",
      };
      session.status = "failed";
      session.endedAt = nowIsoTimestamp();
      appendSessionLog(session, `Unexpected uninstall session error: ${session.result.error}`);
    } finally {
      sessionControl.currentChild = null;
      dependencySessionControls.delete(sessionId);
    }
  })();

  return {
    sessionId,
    operation: session.operation,
    dependencyName: name,
    status: session.status,
    startedAt: session.startedAt,
  };
}

export function getDependencyInstallSessionPayload(sessionId: string) {
  const session = dependencyInstallSessions.get(sessionId);

  if (!session) {
    return null;
  }

  return {
    sessionId: session.id,
    operation: session.operation,
    dependencyName: session.dependencyName,
    status: session.status,
    cancelRequested: dependencySessionControls.get(session.id)?.cancelRequested || false,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    logs: session.logs,
    result: session.result,
  };
}

export function cancelDependencyInstallSession(sessionId: string) {
  const session = dependencyInstallSessions.get(sessionId);
  const control = dependencySessionControls.get(sessionId);

  if (!session || !control) {
    return {
      statusCode: 404,
      payload: {
        success: false,
        message: `Install session '${sessionId}' was not found`,
      },
    };
  }

  if (session.status !== "running") {
    return {
      statusCode: 409,
      payload: {
        success: false,
        message: `Session '${sessionId}' is not running anymore`,
        status: session.status,
      },
    };
  }

  control.cancelRequested = true;
  appendSessionLog(session, "Cancellation requested by user.");

  try {
    if (control.currentChild) {
      control.currentChild.kill();
    }
  } catch {
    // ignore kill failures, polling loop will eventually resolve session
  }

  return {
    statusCode: 200,
    payload: {
      success: true,
      message: "Cancellation requested successfully.",
      sessionId,
      status: session.status,
    },
  };
}
