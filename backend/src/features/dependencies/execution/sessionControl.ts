import type {
  CommandExecutionControl,
  DependencySessionControl,
} from "../shared/dependencyTypes";

export function isSessionCancelled(control?: DependencySessionControl): boolean {
  return Boolean(control?.cancelRequested);
}

export function commandControlFromSession(
  sessionControl?: DependencySessionControl,
): CommandExecutionControl {
  return {
    isCancelled: () => isSessionCancelled(sessionControl),
    setCurrentChild: (child) => {
      if (sessionControl) {
        sessionControl.currentChild = child;
      }
    },
  };
}
