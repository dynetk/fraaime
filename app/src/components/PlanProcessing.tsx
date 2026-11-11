import type { ProcessingJob } from "../lib/processing-jobs";
import { processingAttempts, isProcessing } from "../lib/processing-jobs";

type Props = {
  jobs: ProcessingJob[];
  planId: string;
  busy: boolean;
  indexing: boolean;
  onRun: (job: ProcessingJob) => void;
  onNew: (job: ProcessingJob) => void;
  onCancel: (job: ProcessingJob) => void;
};
function JobStatus({ job }: { job: ProcessingJob }) {
  return (
    <div>
      <b>{job.phase}</b>
      <span className="badge">{job.state.replaceAll("_", " ")}</span>
      <span>
        {job.completed_pages.length} pages completed · $
        {Number(job.spend).toFixed(3)} accounted / reserved
      </span>
      <time className="job-time" dateTime={job.created_at}>
        {new Date(job.created_at).toLocaleString()}
      </time>
      {job.error && <p className="error-text">{job.error}</p>}
    </div>
  );
}
export default function PlanProcessing({
  jobs,
  planId,
  busy,
  indexing,
  onRun,
  onNew,
  onCancel,
}: Props) {
  const [latest, ...history] = processingAttempts(jobs, planId);
  if (!latest) return null;
  const olderRunning = history.some(isProcessing);
  const disabled = busy || indexing || olderRunning;
  return (
    <>
      <section className="job" aria-label="Latest processing attempt">
        <JobStatus job={latest} />
        {olderRunning && (
          <p role="status">
            An earlier attempt is still running. Wait for it to finish or cancel
            it in Processing history.
          </p>
        )}
        {latest.state === "failed" && latest.completed_pages.length > 0 && (
          <p className="fineprint">
            Completed stages are saved. For an output-limit failure, Resume
            reuses them and retries only the unfinished stage. Earlier charges
            remain in history; the resumed stage is a new billable AI call.
          </p>
        )}
        {latest.state === "failed" && (
          <button disabled={disabled} onClick={() => onNew(latest)}>
            Start separate extraction
          </button>
        )}
        {isProcessing(latest) ? (
          <button disabled={busy} onClick={() => onCancel(latest)}>
            Cancel
          </button>
        ) : (
          <button disabled={disabled} onClick={() => onRun(latest)}>
            {latest.state === "needs_selection"
              ? "Process selected sheets"
              : latest.state === "needs_review"
                ? "Create new AI draft"
                : "Resume processing"}
          </button>
        )}
      </section>
      {history.length > 0 && (
        <details
          className="processing-history"
          open={olderRunning || undefined}
        >
          <summary>
            Processing history ({history.length}{" "}
            {history.length === 1 ? "earlier attempt" : "earlier attempts"})
          </summary>
          <p className="fineprint">
            Previous attempts are kept for reference. Use the latest panel above
            to process this PDF.
          </p>
          {history.map((job) => (
            <div className="job history-job" key={job.id}>
              <JobStatus job={job} />
              {isProcessing(job) && (
                <button disabled={busy} onClick={() => onCancel(job)}>
                  Cancel earlier attempt
                </button>
              )}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
