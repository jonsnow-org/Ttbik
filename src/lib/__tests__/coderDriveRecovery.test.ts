import { isRetryableDriveError, safeDriveError, shouldResumeDriveAfterError } from "@/lib/coderDriveRecovery";

describe("Nova runner error recovery", () => {
  it("recognises transient transport and database errors, including nested causes", () => {
    expect(isRetryableDriveError({ name: "TypeError", message: "fetch failed", cause: { code: "ECONNRESET" } })).toBe(true);
    expect(isRetryableDriveError({ code: "P2024", message: "Timed out acquiring a connection" })).toBe(true);
    expect(isRetryableDriveError({ name: "TimeoutError", message: "operation aborted" })).toBe(true);
  });

  it("does not classify ordinary programming or tool errors as transient", () => {
    expect(isRetryableDriveError(new Error("invalid tool arguments"))).toBe(false);
    expect(isRetryableDriveError({ code: "EACCES", message: "permission denied" })).toBe(false);
  });

  it("resumes only safe model-poll/context stages and never an active tool call", () => {
    const job = { job: "s0~job-123", driveRetries: 0 };
    expect(shouldResumeDriveAfterError("poll-model-job", new Error("fetch failed"), job)).toBe(true);
    expect(shouldResumeDriveAfterError("process-model-progress", new Error("fetch failed"), job)).toBe(true);
    expect(shouldResumeDriveAfterError("execute-tool:github_edit_file", new Error("fetch failed"), job)).toBe(false);
    expect(shouldResumeDriveAfterError("submit-model-request", new Error("fetch failed"), {})).toBe(false);
    expect(shouldResumeDriveAfterError("poll-model-job", new Error("invalid response"), job)).toBe(false);
    expect(shouldResumeDriveAfterError("poll-model-job", new Error("fetch failed"), { ...job, queued: [{ id: "pending" }] })).toBe(false);
    expect(shouldResumeDriveAfterError("process-model-progress", new Error("fetch failed"), { ...job, delegating: { id: "d" } })).toBe(false);
  });

  it("caps recovery attempts so persistent failures become visible", () => {
    expect(shouldResumeDriveAfterError("poll-model-job", new Error("fetch failed"), { job: "job-123", driveRetries: 2 })).toBe(false);
  });

  it("redacts bearer credentials, token-like values, and URLs from diagnostics", () => {
    const detail = safeDriveError(new Error("request failed Bearer abcdefghijklmnop ghp_123456789012345678901234 https://example.com/path?token=secret"));
    expect(detail).not.toContain("abcdefghijklmnop");
    expect(detail).not.toContain("ghp_123456789012345678901234");
    expect(detail).not.toContain("example.com");
    expect(detail).toContain("[redacted]");
    expect(detail).toContain("[URL]");
  });
});
