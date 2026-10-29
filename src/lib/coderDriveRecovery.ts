export type DriveRecoveryState = {
  job?: string;
  queued?: unknown[];
  pending?: unknown;
  asking?: unknown;
  delegating?: unknown;
  driveRetries?: number;
};

const RETRYABLE_CODES = new Set([
  "P1001", // database server unreachable
  "P1002", // database timeout
  "P1017", // database connection closed
  "P2024", // connection-pool timeout
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNABORTED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TRANSIENT_MESSAGE =
  /fetch failed|network error|socket hang up|connection (?:reset|terminated|closed|refused)|timed? out|timeout|temporarily unavailable|server closed the connection|too many connections/i;

/** Redacts common credentials and URLs before a diagnostic is persisted or displayed. */
export function sanitizeDriveDiagnostic(value: string, maxLength = 240): string {
  return String(value || "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b/gi, "[redacted]")
    .replace(/((?:token|secret|password|authorization|api[_-]?key)\s*[=:]\s*)[^,;\s]+/gi, "$1[redacted]")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** A short, redacted description suitable for persistent task diagnostics. */
export function safeDriveError(error: unknown): string {
  const item = error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : undefined;
  const name = String(item?.name || "Error").slice(0, 60);
  const message = String(item?.message ?? error ?? "unknown error");
  return sanitizeDriveDiagnostic(`${name}: ${message}`, 240);
}

/** Only known transport/database interruptions qualify; arbitrary code/tool errors must not be retried. */
export function isRetryableDriveError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<object>();

  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object") {
      if (seen.has(current)) break;
      seen.add(current);
      const item = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
      const code = String(item.code || "").toUpperCase();
      const name = String(item.name || "");
      const message = String(item.message || "");

      if (RETRYABLE_CODES.has(code) || name === "TimeoutError" || name === "AbortError" || TRANSIENT_MESSAGE.test(message)) return true;
      current = item.cause;
      continue;
    }

    if (TRANSIENT_MESSAGE.test(String(current))) return true;
    break;
  }

  return false;
}

/**
 * Resuming is safe only before a tool has run: polling an existing Studio job and handling a
 * pending/progress result are read-only with respect to model/tool side effects; preparing context
 * has not submitted a model request. Tool execution and ambiguous model submissions must not retry.
 */
export function shouldResumeDriveAfterError(stage: string, error: unknown, run: DriveRecoveryState): boolean {
  if (!isRetryableDriveError(error)) return false;
  if (stage !== "prepare-context" && stage !== "poll-model-job" && stage !== "process-model-progress") return false;
  if (run.pending || run.asking || run.delegating || (run.queued?.length || 0) > 0) return false;
  if ((stage === "poll-model-job" || stage === "process-model-progress") && !run.job) return false;
  return (run.driveRetries || 0) < 2;
}
