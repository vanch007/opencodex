import { test, expect } from "bun:test";
import { selectPriorityTier } from "../../src/codex/pool-rotation";
import { repoPath } from "../helpers/repo-root";
const source = await Bun.file(repoPath("src/codex/routing/selection.ts")).text();
// Priority applies to unbound placement; warm-thread failback is covered by
// codex-priority-failback.test.ts under the upstream opt-in contract.
const extract = (name: string) => {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing selection function: ${name}`);
  const end = source.indexOf("\n}\n", start) + 2;
  return source.slice(start, end);
};
function harness(eligible = ["plus", "prolite"], pin?: string) {
  const priority = (id: string) => id === "plus" ? 2 : -1;
  const deps = {
    getEligiblePoolAccounts: () => selectPriorityTier(eligible, priority, () => true, pin),
    pinnedCodexAccountId: () => pin,
    hasCodexQuotaHeadroom: () => true,
    codexAccountPriorityLookup: () => priority,
    pickLowestUsageAmong: (_: unknown, ids: string[]) => ids[0] ?? null,
  };
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
    extract("pickPriorityPreemption") + "\nreturn {pickPriorityPreemption};",
  );
  return new Function(...Object.keys(deps), js)(...Object.values(deps));
}
test("unbound placement prefers the highest eligible priority in every strategy", () => {
  const h = harness();
  for (const accountPoolStrategy of ["quota", "fill-first", "round-robin"]) {
    expect(h.pickPriorityPreemption({ accountPoolStrategy }, "prolite", 1001)).toBe("plus");
  }
});
test("unavailable/model-ineligible higher tier cannot preempt", () => {
  expect(harness(["prolite"]).pickPriorityPreemption({}, "prolite", 1001)).toBeNull();
});
test("explicit manual pin retains its priority ceiling", () => {
  expect(harness(undefined, "prolite").pickPriorityPreemption({}, "prolite", 1001)).toBeNull();
});
test("an active higher tier does not switch down", () => {
  expect(harness().pickPriorityPreemption({}, "plus", 1001)).toBeNull();
});
