import React, { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../../lib/utils";

export interface GlassWindowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Optional window title displayed in the center or left of the title bar */
  title?: ReactNode;
  /** Optional secondary text below or alongside the title */
  subtitle?: ReactNode;
  /** Custom actions rendered on the right side of the window header */
  headerActions?: ReactNode;
  /** Whether to show macOS Sequoia / visionOS style traffic lights window controls */
  showControls?: boolean;
  /** Callbacks for window control actions */
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  /** Whether to render ambient diffuse background lighting orbs behind the window */
  ambientGlow?: boolean;
  /** Custom class for the inner content container */
  contentClassName?: string;
}

export const GlassWindow = forwardRef<HTMLDivElement, GlassWindowProps>(function GlassWindow(
  {
    title,
    subtitle,
    headerActions,
    showControls = true,
    onClose,
    onMinimize,
    onMaximize,
    ambientGlow = true,
    className,
    contentClassName,
    children,
    ...rest
  },
  ref,
) {
  const hasHeader = showControls || Boolean(title) || Boolean(headerActions);

  return (
    <div
      ref={ref}
      className={cn(
        "relative w-full overflow-hidden rounded-[20px] md:rounded-[26px]",
        // Liquid Glass surface
        "bg-[#0d0e12]/80 backdrop-blur-[28px] md:backdrop-blur-[32px] saturate-[180%]",
        // Unified crisp glass border
        "border border-white/[0.08]",
        // Specular top highlight & deep ambient shadow
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.14),0_24px_64px_-12px_rgba(0,0,0,0.65)]",
        className,
      )}
      {...rest}
    >
      {/* Ambient Diffuse Lighting Orbs */}
      {ambientGlow && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          {/* Subtle Emerald / Teal Accent Glow */}
          <div className="ambient-glow-orb -top-24 -left-20 h-80 w-80 bg-emerald-500/10 blur-[140px]" />
          {/* Deep Indigo Atmosphere Glow */}
          <div className="ambient-glow-orb top-1/3 -right-24 h-96 w-96 bg-indigo-500/10 blur-[140px]" />
          {/* Monochromatic White Highlight Glow */}
          <div className="ambient-glow-orb -bottom-28 left-1/4 h-80 w-80 bg-white/[0.06] blur-[140px]" />
        </div>
      )}

      {/* Unified Window Title Bar */}
      {hasHeader && (
        <header className="relative flex h-11 items-center justify-between border-b border-white/[0.06] px-4 md:px-5 select-none bg-white/[0.02]">
          {/* Left: Window Controls */}
          <div className="flex items-center gap-2 min-w-[72px]">
            {showControls && (
              <div className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close window"
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-white/[0.12] transition-colors hover:bg-red-500/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
                >
                  <svg
                    className="h-1.5 w-1.5 opacity-0 transition-opacity group-hover:opacity-100 text-black"
                    viewBox="0 0 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M1 1L5 5M5 1L1 5" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onMinimize}
                  aria-label="Minimize window"
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-white/[0.12] transition-colors hover:bg-yellow-500/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yellow-400"
                >
                  <svg
                    className="h-1.5 w-1.5 opacity-0 transition-opacity group-hover:opacity-100 text-black"
                    viewBox="0 0 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M1 3H5" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onMaximize}
                  aria-label="Expand window"
                  className="flex h-3 w-3 items-center justify-center rounded-full bg-white/[0.12] transition-colors hover:bg-emerald-500/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                >
                  <svg
                    className="h-1.5 w-1.5 opacity-0 transition-opacity group-hover:opacity-100 text-black"
                    viewBox="0 0 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <path d="M1 1H5V5" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* Center: Window Title */}
          {title && (
            <div className="flex flex-col items-center justify-center text-center">
              <div className="text-xs font-medium tracking-wide text-zinc-200">
                {title}
              </div>
              {subtitle && (
                <div className="text-[10px] text-zinc-400 tracking-normal">
                  {subtitle}
                </div>
              )}
            </div>
          )}

          {/* Right: Window Header Actions */}
          <div className="flex items-center justify-end gap-2 min-w-[72px]">
            {headerActions}
          </div>
        </header>
      )}

      {/* Window Body */}
      <div className={cn("relative p-4 md:p-6", contentClassName)}>
        {children}
      </div>
    </div>
  );
});
