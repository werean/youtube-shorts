export interface NarrativeArc {
  hook: string;
  development: string;
  climax: string;
  resolution: string;
}

export type VerticalMode = 'crop' | 'blur' | 'zoom' | 'split_podcast';

export interface Cut {
  cut_id: string;
  id?: string;
  block_ids?: string[];
  start: number;
  end: number;
  duration?: number;
  title?: string | null;
  status?: string;
  summary?: string;
  reasoning?: string;
  score?: number;
  approved?: boolean;
  rejected?: boolean;
  subtitle?: string;
  explanation?: string;
  viral_score?: number;
  narrative_arc?: NarrativeArc;
  vertical_mode?: VerticalMode;
}
