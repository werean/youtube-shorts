import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "../../shared/classNames";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  animate?: boolean;
  lines?: number;
  lineGap?: number;
}

function toCssLength(value?: number | string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" ? `${value}px` : value;
}

function SkeletonLine({
  width,
  height,
  borderRadius,
  animate,
  className,
  ...rest
}: Omit<SkeletonProps, "lines" | "lineGap">) {
  const style: CSSProperties = {
    width: toCssLength(width) || "100%",
    height: toCssLength(height) || "14px",
    borderRadius: toCssLength(borderRadius) || "8px",
  };

  return (
    <span
      className={cn("ui-skeleton", animate ? "ui-skeleton--animate" : "", className || "")}
      style={style}
      aria-hidden="true"
      {...rest}
    />
  );
}

export function Skeleton({
  width,
  height,
  borderRadius,
  animate = true,
  lines = 1,
  lineGap = 8,
  className,
  ...rest
}: SkeletonProps) {
  if (lines <= 1) {
    return (
      <SkeletonLine
        width={width}
        height={height}
        borderRadius={borderRadius}
        animate={animate}
        className={className}
        {...rest}
      />
    );
  }

  const rows = Array.from({ length: lines }, (_, index) => index);

  return (
    <span
      className={cn("ui-skeleton-stack", className || "")}
      style={{ gap: `${lineGap}px` }}
      aria-hidden="true"
    >
      {rows.map((row) => (
        <SkeletonLine
          key={row}
          width={row === rows.length - 1 ? "82%" : width}
          height={height}
          borderRadius={borderRadius}
          animate={animate}
          {...rest}
        />
      ))}
    </span>
  );
}
