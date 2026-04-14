import {
  useEffect,
  useId,
  useMemo,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type ModalSize = "sm" | "md" | "lg" | "xl";

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
  closeLabel?: string;
  initialFocusRef?: RefObject<HTMLElement>;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

function trapTabKey(event: ReactKeyboardEvent<HTMLDivElement>, container: HTMLElement): void {
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

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  closeOnEscape = true,
  closeOnOverlayClick = true,
  closeLabel = "Fechar modal",
  initialFocusRef,
  className = "",
  children,
  ...rest
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const describedBy = useMemo(() => {
    return description ? descriptionId : undefined;
  }, [description, descriptionId]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = getFocusableElements(dialog);
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialog.focus();
      }
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open || !closeOnEscape || typeof document === "undefined") {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeOnEscape, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="ui-modal-root" role="presentation">
      <div
        className="ui-modal-overlay"
        onMouseDown={(event) => {
          if (closeOnOverlayClick && event.target === event.currentTarget) {
            onClose();
          }
        }}
      />

      <div
        ref={dialogRef}
        className={["ui-modal", `ui-modal--${size}`, className].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (dialogRef.current) {
            trapTabKey(event, dialogRef.current);
          }
        }}
        {...rest}
      >
        <header className="ui-modal__header">
          <div>
            <h2 id={titleId} className="ui-modal__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="ui-modal__description">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            className="ui-modal-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="ui-modal__body">{children}</div>
        {footer ? <footer className="ui-modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
