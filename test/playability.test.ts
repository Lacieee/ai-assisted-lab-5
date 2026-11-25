// Regression tests for bugs that made the game broken, unfair or unplayable (see BUGS.md).
// Each test was written to fail before its fix.
import { describe, expect, it } from "vitest";
import { Ui } from "../src/ui/ui";
import { LEVELS } from "../src/levels/index";

const isUnlocked = (index: number, cleared: string[] = []) =>
  Ui.prototype.isUnlocked.call({ levels: LEVELS, save: { levels: Object.fromEntries(cleared.map((id) => [id, { cleared: true }])) } }, index);

describe("BUGS.md #1: level unlocking", () => {
  it("the first level is playable on a fresh save", () => expect(isUnlocked(0)).toBe(true));
  it("the second level is locked until the first is cleared", () => {
    expect(isUnlocked(1)).toBe(false);
    expect(isUnlocked(1, ["1-1"])).toBe(true);
  });
});
