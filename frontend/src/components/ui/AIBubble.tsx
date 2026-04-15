import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export interface AIBubbleProps extends HTMLAttributes<HTMLDivElement> {
  modelName: string;
  content: string;
  highlights?: string[];
}

function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M9 3a3 3 0 0 0-3 3v1.1A3 3 0 0 0 4 10v4a3 3 0 0 0 2 2.83V18a3 3 0 0 0 3 3h1v-6H8v-2h2v-2H8V9h2V7H8V6a1 1 0 1 1 2 0v1h2V6a3 3 0 0 0-3-3zm6 0a3 3 0 0 0-3 3v1h2V6a1 1 0 1 1 2 0v1h-2v2h2v2h-2v2h2v6h1a3 3 0 0 0 3-3v-1.17A3 3 0 0 0 20 14v-4a3 3 0 0 0-2-2.9V6a3 3 0 0 0-3-3z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderWithHighlights(text: string, highlights: string[]) {
  if (highlights.length === 0) {
    return <span>{text}</span>;
  }

  const escaped = highlights
    .filter((item) => item.trim().length > 0)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (escaped.length === 0) {
    return <span>{text}</span>;
  }

  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const pieces = text.split(pattern);

  return (
    <>
      {pieces.map((piece, index) => {
        const match = escaped.some((candidate) => new RegExp(`^${candidate}$`, "i").test(piece));
        return match ? (
          <strong key={`${piece}-${index}`} className="font-medium text-text-1">
            {piece}
          </strong>
        ) : (
          <span key={`${piece}-${index}`}>{piece}</span>
        );
      })}
    </>
  );
}

export function AIBubble({
  modelName,
  content,
  highlights = [],
  className,
  ...rest
}: AIBubbleProps) {
  return (
    <article
      className={cn("space-y-3 rounded-md border-[0.5px] border-border-2 bg-bg-2 p-3", className)}
      {...rest}
    >
      <div className="inline-flex items-center gap-2 rounded-[5px] border-[0.5px] border-border-1 px-2 py-[2px] text-caption text-text-3">
        <BrainIcon />
        <span>{modelName}</span>
      </div>
      <p className="text-body text-text-2">{renderWithHighlights(content, highlights)}</p>
    </article>
  );
}
