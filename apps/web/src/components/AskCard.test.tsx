import { describe, expect, it } from "vitest";
import { selectedAskActionLabel } from "./ask-card-state.js";

describe("selectedAskActionLabel", () => {
  it("maps a choice answer id to its user-facing label", () => {
    expect(
      selectedAskActionLabel("seoul", [
        { id: "berlin", label: "Berlin" },
        { id: "seoul", label: "Seoul" },
      ]),
    ).toBe("Seoul");
  });

  it("falls back to the answer when an action is unavailable", () => {
    expect(selectedAskActionLabel("custom", undefined)).toBe("custom");
  });
});
