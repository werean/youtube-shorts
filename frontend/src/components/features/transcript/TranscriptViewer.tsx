import type { HTMLAttributes } from "react";
import {
  TranscriptViewer as TranscriptViewerPrimitive,
  type TranscriptLine,
  type TranscriptViewerProps,
} from "../../ui/TranscriptViewer";

export interface TranscriptFeatureViewerProps
  extends TranscriptViewerProps, Omit<HTMLAttributes<HTMLDivElement>, keyof TranscriptViewerProps> {
  modelName?: string;
}

export function TranscriptViewer({ modelName, ...rest }: TranscriptFeatureViewerProps) {
  return (
    <div className="space-y-2">
      {modelName ? <p className="text-caption text-text-3">MODEL {modelName}</p> : null}
      <TranscriptViewerPrimitive {...rest} />
    </div>
  );
}

export type { TranscriptLine };
