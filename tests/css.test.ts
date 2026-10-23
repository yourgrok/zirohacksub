import { describe, expect, it } from "vitest";
import fs from "node:fs";

// A stray unclosed "@media {" once swallowed the whole side-menu block, so the menu was only vertical on phones.
describe("console stylesheet", () => {
  it("has balanced braces (no block is left open or closed twice)", () => {
    const css = fs.readFileSync("web/src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    for (const [i, ch] of [...css].entries()) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth, `unexpected "}" near character ${i}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, "a block is never closed").toBe(0);
  });
});
