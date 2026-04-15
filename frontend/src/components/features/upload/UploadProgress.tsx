import type { HTMLAttributes } from "react";
import { Card } from "../../ui/Card";
import { Progress } from "../../ui/Progress";
import { StatusRow, type StatusRowState } from "../../ui/StatusRow";

export interface UploadProgressProps extends HTMLAttributes<HTMLDivElement> {
  progress: number;
  state: StatusRowState;
  filename: string;
}

export function UploadProgress({ progress, state, filename, ...rest }: UploadProgressProps) {
  return (
    <Card
      {...rest}
      variant="flat"
      body={
        <div className="space-y-3">
          <StatusRow state={state} text={filename} tag={state} />
          <Progress label="Upload progress" value={progress} />
        </div>
      }
    />
  );
}
