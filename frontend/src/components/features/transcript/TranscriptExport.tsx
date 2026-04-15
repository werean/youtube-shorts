import { useState } from "react";
import type { HTMLAttributes } from "react";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";

export type TranscriptExportFormat = "txt" | "vtt" | "json";

export interface TranscriptExportProps extends HTMLAttributes<HTMLDivElement> {
  onExport: (format: TranscriptExportFormat) => Promise<void> | void;
}

export function TranscriptExport({ onExport, ...rest }: TranscriptExportProps) {
  const [format, setFormat] = useState<TranscriptExportFormat>("txt");
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      await onExport(format);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      {...rest}
      variant="flat"
      header={<p className="text-heading-sm text-text-1">Transcript export</p>}
      body={
        <div className="flex items-center gap-2">
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as TranscriptExportFormat)}
            className="select-field h-8 rounded-md border-[0.5px] border-border-1 bg-bg-3 px-2 text-body text-text-1 focus:border-border-3 focus:outline-none"
          >
            <option value="txt">TXT</option>
            <option value="vtt">VTT</option>
            <option value="json">JSON</option>
          </select>
          <Button variant="ghost" loading={busy} loadingLabel="Exporting" onClick={handleExport}>
            Export
          </Button>
        </div>
      }
    />
  );
}
