// Headless playthrough of Act 1, levels 1-3, by a scripted player (test/bot/bot.ts) that uses the same
// input path as a human: mouse deltas at a human turn rate, WASD, click/E. It aims while standing still,
// dodges bullets it can see and shoots what is in sight. The bot is a mediocre player on purpose: the
// test does not demand that it wins every time, only that the levels can be won and never deadlock.
import { describe, expect, it } from "vitest";
import { playAttempt } from "./bot/bot";

const ATTEMPTS = 10;

describe("Act 1 can be played through", () => {
  for (const [index, id] of [[0, "1-1"], [1, "1-2"], [2, "1-3"]] as const) {
    it(`level ${id}: clearable, and no attempt gets stuck`, () => {
      const results = Array.from({ length: ATTEMPTS }, (_, i) => playAttempt(index, 90, i + 1));
      const summary = results.map((r) => `${r.result} @${r.simSeconds}s${r.death ? " — " + r.death.slice(0, 120) : ""}`);
      // a timeout means the level reached a state the player can't finish (BUGS.md #15, #16)
      expect(results.filter((r) => r.result === "timeout"), summary.join("\n")).toEqual([]);
      expect(results.filter((r) => r.result === "cleared").length, summary.join("\n")).toBeGreaterThanOrEqual(2);
    }, 60_000);
  }
});
