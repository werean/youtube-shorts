import type { ReactNode } from "react";
import { AppButton } from "./AppButton";

interface AppDialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  showHeaderClose?: boolean;
  wide?: boolean;
  scrollable?: boolean;
  disableClose?: boolean;
  onOverlayClick?: () => void;
}

export function AppDialog({
  title,
  onClose,
  children,
  footer,
  showHeaderClose = true,
  wide = false,
  scrollable = false,
  disableClose = false,
  onOverlayClick,
}: AppDialogProps) {
  return (
    <div
      className="dialog-overlay app-dialog-overlay"
      onClick={() => {
        if (!disableClose) {
          (onOverlayClick || onClose)();
        }
      }}
    >
      <div
        className={`dialog app-dialog ${wide ? "wide" : ""} ${scrollable ? "scrollable" : ""}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header app-dialog-header">
          <h3>{title}</h3>
          {showHeaderClose ? (
            <div className="dialog-actions app-dialog-actions">
              <AppButton
                variant="ghost"
                className="icon-btn close-btn"
                onClick={onClose}
                disabled={disableClose}
                aria-label="Fechar"
              >
                X
              </AppButton>
            </div>
          ) : null}
        </div>
        <div className="dialog-content app-dialog-content">{children}</div>
        {footer ? <div className="dialog-footer app-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
