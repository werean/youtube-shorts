import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

export function trapTabKey(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement): void {
  if (event.key !== "Tab") {
    return;
  }

  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}
