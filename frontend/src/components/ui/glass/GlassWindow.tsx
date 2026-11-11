import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export interface GlassWindowProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional ambient diffuse background lighting orbs behind the window */
  ambientGlow?: boolean;
  /** Custom class for the inner content container */
  contentClassName?: string;
  /** Legacy props tolerated for backwards compatibility */
  title?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  showControls?: boolean;
  hideTrafficLights?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
}

export const GlassWindow = forwardRef<HTMLDivElement, GlassWindowProps>(function GlassWindow(
  {
    ambientGlow = true,
    className,
    contentClassName,
    children,
    title: _title,
    subtitle: _subtitle,
    headerActions: _headerActions,
    showControls: _showControls,
    hideTrafficLights: _hideTrafficLights,
    onClose: _onClose,
    onMinimize: _onMinimize,
    onMaximize: _onMaximize,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "relative w-full h-full flex flex-col overflow-hidden bg-[#07080b] text-[#f5f5f7] select-none",
        className,
      )}
      {...rest}
    >
      {/* Ambient Diffuse Lighting Orbs */}
      {ambientGlow && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {/* Subtle Emerald / Teal Accent Glow */}
          <div className="ambient-glow-orb -top-32 -left-20 h-96 w-96 bg-emerald-500/10 blur-[150px]" />
          {/* Deep Indigo Atmosphere Glow */}
          <div className="ambient-glow-orb top-1/3 -right-24 h-96 w-96 bg-indigo-500/10 blur-[160px]" />
          {/* Monochromatic White Highlight Glow */}
          <div className="ambient-glow-orb -bottom-28 left-1/4 h-96 w-96 bg-white/[0.04] blur-[150px]" />
        </div>
      )}

      {/* Main Container Content */}
      <div className={cn("relative z-10 flex-1 flex flex-col overflow-hidden w-full h-full", contentClassName)}>
        {children}
      </div>
    </div>
  );
});
