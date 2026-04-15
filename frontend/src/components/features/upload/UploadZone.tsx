import type { HTMLAttributes } from "react";
import { Card } from "../../ui/Card";
import { UploadZone as UploadZonePrimitive, type UploadZoneProps } from "../../ui/UploadZone";

export interface UploadFeatureZoneProps extends UploadZoneProps, HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
}

export function UploadZone({
  title = "Upload source video",
  description = "Drop a file to start processing instantly.",
  ...rest
}: UploadFeatureZoneProps) {
  return (
    <Card
      header={
        <div>
          <h2 className="text-heading-sm text-text-1">{title}</h2>
          <p className="text-body-sm text-text-2">{description}</p>
        </div>
      }
      body={<UploadZonePrimitive {...rest} />}
    />
  );
}
