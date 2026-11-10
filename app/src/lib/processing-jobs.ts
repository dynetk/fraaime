export type ProcessingJob = {
  id: string;
  plan_id: string;
  state: string;
  phase: string;
  error: string | null;
  pages: number[];
  completed_pages: number[];
  spend: string;
  created_at: string;
};
export const isProcessing = (job: ProcessingJob) =>
  ["preparing", "extracting"].includes(job.state);
/** Never mutate the server response; equal timestamps retain its existing order. */
export function processingAttempts(jobs: ProcessingJob[], planId: string) {
  return jobs
    .filter((job) => job.plan_id === planId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
