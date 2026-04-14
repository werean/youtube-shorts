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
import { cn } from "../../shared/classNames";
import { getFocusableElements, trapTabKey } from "./focusManagement";

export type ModalSize = "sm" | "md" | "lg" | "xl";

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeLabel?: string;
  closeOnOverlayClick?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
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
        className={cn("ui-modal", `ui-modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
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
