import type { Job } from "../../models/job";
import type { VideoRecord as SharedVideoRecord } from "@youtube-shorts/contracts";

export interface VideoRecord extends Omit<SharedVideoRecord, "job"> {
  job: Job | null;
}
