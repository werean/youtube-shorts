import type { HTMLAttributes } from "react";
import { Card } from "../../ui/Card";
import { StatusRow, type StatusRowState } from "../../ui/StatusRow";

export interface ClipPlayerProps extends HTMLAttributes<HTMLDivElement> {
  src?: string;
  poster?: string;
  title?: string;
  state?: StatusRowState;
}

export function ClipPlayer({
  src,
  poster,
  title = "Preview",
  state = "ready",
  ...rest
}: ClipPlayerProps) {
  return (
    <Card
      {...rest}
      header={<p className="text-heading-sm text-text-1">{title}</p>}
      body={
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border-[0.5px] border-border-1 bg-bg-2">
            {src ? (
              <video controls src={src} poster={poster} className="h-full w-full" />
            ) : (
              <div className="flex h-[220px] items-center justify-center text-body text-text-3">
                No clip selected
              </div>
            )}
          </div>
          <StatusRow state={state} text={src ? "Clip ready" : "Awaiting clip"} tag={state} />
        </div>
      }
    />
  );
}
