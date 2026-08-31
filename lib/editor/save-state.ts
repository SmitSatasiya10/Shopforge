export type SaveOutcome = "saved" | "conflict" | "error";

// Pure classification of an autosave response's HTTP status, factored out of the editor page's
// save flow so it's unit-testable without mocking fetch/DOM. 409 is the optimistic-concurrency
// conflict (see app/api/project/[id]/configuration/route.ts); any other non-2xx is a plain
// failure.
export function classifySaveResponseStatus(status: number): SaveOutcome {
  if (status === 409) return "conflict";
  if (status >= 200 && status < 300) return "saved";
  return "error";
}
