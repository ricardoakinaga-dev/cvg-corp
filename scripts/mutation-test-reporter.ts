/**
 * node:test reporter used by the mutation verifier (FQ-04). The text summary
 * prints `fail 1` both for an assertion that failed inside a running test and
 * for a file that never loaded or a process that exited early; this reporter
 * writes one JSON line per finished test so the verifier can tell them apart.
 */
interface ReporterTestEvent {
  type: string;
  data?: {
    details?: {
      type?: string;
      error?: { failureType?: unknown; exitCode?: unknown; cause?: unknown };
    };
  };
}

export default async function* mutationTestReporter(source: AsyncIterable<ReporterTestEvent>): AsyncGenerator<string> {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const details = event.data?.details;
    const error = details?.error;
    yield `${JSON.stringify({
      outcome: event.type === "test:pass" ? "pass" : "fail",
      kind: details?.type ?? "test",
      failureType: typeof error?.failureType === "string" ? error.failureType : null,
      // The runner synthesizes a file-level failure carrying the child's exit code
      // when a file crashes before or outside its tests.
      processExit: error !== undefined && "exitCode" in error,
      thrown: error !== undefined && "cause" in error && error.cause !== undefined
    })}\n`;
  }
}
