import { useMemo, useState, type HTMLAttributes } from "react";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ClipCard, type ClipCardProps } from "./ClipCard";

export type ClipSortBy = "score" | "duration" | "timestamp";

export interface ClipListItem extends ClipCardProps {
  id: string;
}

export interface ClipListProps extends HTMLAttributes<HTMLDivElement> {
  clips: ClipListItem[];
  onEmptyAction?: () => void;
  onClearSession?: () => void;
}

export function ClipList({ clips, onEmptyAction, onClearSession, ...rest }: ClipListProps) {
  const [sortBy, setSortBy] = useState<ClipSortBy>("score");
  const [descending, setDescending] = useState(true);

  const sortedClips = useMemo(() => {
    const list = [...clips];
    list.sort((a, b) => {
      const factor = descending ? -1 : 1;

      if (sortBy === "score") {
        return (a.score - b.score) * factor;
      }

      if (sortBy === "duration") {
        return (a.durationSeconds - b.durationSeconds) * factor;
      }

      return (a.timestampSeconds - b.timestampSeconds) * factor;
    });
    return list;
  }, [clips, sortBy, descending]);

  if (clips.length === 0) {
    return (
      <Card
        {...rest}
        header={<p className="text-heading-sm text-text-1">Generated clips</p>}
        body={
          <div className="space-y-3 text-center">
            <p className="text-body text-text-2">No clips generated yet.</p>
            <div className="flex justify-center">
              <Button variant="ghost" onClick={onEmptyAction}>
                Generate clips
              </Button>
            </div>
          </div>
        }
      />
    );
  }

  return (
    <Card
      {...rest}
      header={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-heading-sm text-text-1">Generated clips</p>
          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as ClipSortBy)}
              className="select-field h-8 rounded-md border-[0.5px] border-border-1 bg-bg-3 px-2 text-body text-text-1"
            >
              <option value="score">Sort by score</option>
              <option value="duration">Sort by duration</option>
              <option value="timestamp">Sort by timestamp</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => setDescending((value) => !value)}>
              {descending ? "Desc" : "Asc"}
            </Button>
          </div>
        </div>
      }
      body={
        <div className="space-y-2">
          {sortedClips.map((clip) => (
            <ClipCard key={clip.id} {...clip} />
          ))}
        </div>
      }
      footer={
        onClearSession ? (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const confirmed = window.confirm("Clear current clip session?");
                if (confirmed) {
                  onClearSession();
                }
              }}
            >
              Clear session
            </Button>
          </div>
        ) : null
      }
    />
  );
}
