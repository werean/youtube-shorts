import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { SYSTEM_PROMPT_TEMPLATE } from "../../../src/llm/prompts";
import { continuesSentence } from "../../../src/pipeline/sentence";

describe("cut selection prompt", () => {
  it("treats 15 to 90 seconds as a loose preference, not a quota", () => {
    expect(SYSTEM_PROMPT_TEMPLATE).toContain("about 15 to 90 seconds");
    expect(SYSTEM_PROMPT_TEMPLATE).toContain("not a quota");
    expect(SYSTEM_PROMPT_TEMPLATE).toContain("outside the window");
    expect(SYSTEM_PROMPT_TEMPLATE).not.toContain("1–3 cuts");
    expect(SYSTEM_PROMPT_TEMPLATE).not.toContain("at least 3 consecutive blocks");
    expect(SYSTEM_PROMPT_TEMPLATE).not.toMatch(/300/);
    expect(SYSTEM_PROMPT_TEMPLATE).not.toMatch(/5 minutes/);

    const example = SYSTEM_PROMPT_TEMPLATE.match(/"start":\s*([\d.]+),\s*"end":\s*([\d.]+)/);
    expect(example).not.toBeNull();
    const duration = Number(example?.[2]) - Number(example?.[1]);
    expect(duration).toBeGreaterThanOrEqual(15);
    expect(duration).toBeLessThanOrEqual(90);
  });

  it("keeps the shipped default prompt on the same loose duration", () => {
    const defaults = readFileSync(new URL("../../../../data/default_configs.json", import.meta.url), "utf-8");
    expect(defaults).toContain("about 15 to 90 seconds");
    expect(defaults).toContain("not a quota");
    expect(defaults).not.toContain("gpt-oss:120b-cloud");
    expect(defaults).not.toContain("300 seconds");
    expect(defaults).not.toContain("372.4");
  });
});

describe("continuesSentence", () => {
  it("stops after a finished sentence even when the next word is lowercase", () => {
    expect(continuesSentence("The sentence is finished.", "and this is new.")).toBe(false);
    expect(continuesSentence("What happens next?", "and then more.")).toBe(false);
  });

  it("continues only when the sentence is still open", () => {
    expect(continuesSentence("The point is", "still open")).toBe(true);
    expect(continuesSentence("still open", "and now it ends.")).toBe(true);
  });
});
