import type { HTMLAttributes } from "react";
import { Card } from "../../ui/Card";
import { AIBubble as AIBubblePrimitive, type AIBubbleProps } from "../../ui/AIBubble";

export interface AIAnalysisBubbleProps extends AIBubbleProps, HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export function AIBubble({ title = "AI analysis", ...rest }: AIAnalysisBubbleProps) {
  return (
    <Card
      header={<p className="text-heading-sm text-text-1">{title}</p>}
      body={<AIBubblePrimitive {...rest} />}
    />
  );
}
