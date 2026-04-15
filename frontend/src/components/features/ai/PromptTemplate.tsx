import { useMemo, useState } from "react";
import type { HTMLAttributes } from "react";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";

export interface PromptTemplateItem {
  id: string;
  name: string;
  prompt: string;
}

export interface PromptTemplateProps extends HTMLAttributes<HTMLDivElement> {
  templates: PromptTemplateItem[];
  onRun: (prompt: string) => Promise<void> | void;
}

export function PromptTemplate({ templates, onRun, ...rest }: PromptTemplateProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  const selectedPrompt = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId)?.prompt ?? "",
    [templates, selectedTemplateId],
  );

  async function handleRun() {
    setBusy(true);
    try {
      await onRun(selectedPrompt);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      {...rest}
      header={<p className="text-heading-sm text-text-1">Prompt template</p>}
      body={
        <div className="space-y-2">
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="select-field h-8 w-full rounded-md border-[0.5px] border-border-1 bg-bg-3 px-2 text-body text-text-1 focus:border-border-3 focus:outline-none"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <textarea
            value={selectedPrompt}
            readOnly
            className="min-h-[88px] w-full rounded-md border-[0.5px] border-border-1 bg-bg-2 p-2 text-body-sm text-text-2"
          />
          <Button variant="ghost" loading={busy} loadingLabel="Running" onClick={handleRun}>
            Run analysis
          </Button>
        </div>
      }
    />
  );
}
