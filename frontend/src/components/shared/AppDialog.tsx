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
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
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
