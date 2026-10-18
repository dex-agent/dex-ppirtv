import { describe, expect, it } from "vitest";
import { sanitizeReviewScaffold } from "../src/server.js";

function status(reviewedTargets: unknown, scopeReference: unknown) {
  return {
    next_required_action: {
      type: "attach_review",
      required_tool_sequence: [
        {
          args: {
            scope_reference: scopeReference,
            observed_result: { reviewed_targets: reviewedTargets }
          }
        }
      ]
    }
  };
}

describe("review scaffold sanitization", () => {
  it("preserves real string targets and scope", () => {
    const result = sanitizeReviewScaffold(status(["src/a.ts"], "src/a.ts"));
    const step = result.next_required_action.required_tool_sequence[0];
    expect(step.args.observed_result.reviewed_targets).toEqual(["src/a.ts"]);
    expect(step.args.scope_reference).toBe("src/a.ts");
  });

  it("drops [object Object] and falls back to a required placeholder", () => {
    const result = sanitizeReviewScaffold(status(["[object Object]"], "[object Object]"));
    const step = result.next_required_action.required_tool_sequence[0];
    expect(step.args.observed_result.reviewed_targets).toEqual([
      "<required:exact scope.in or changed_files reference>"
    ]);
    expect(step.args.scope_reference).toBe("<required:exact scope.in or changed_files reference>");
  });
});
