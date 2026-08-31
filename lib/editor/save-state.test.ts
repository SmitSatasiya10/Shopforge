import { describe, expect, it } from "vitest";
import { classifySaveResponseStatus } from "./save-state";

describe("classifySaveResponseStatus", () => {
  it("treats 2xx as saved", () => {
    expect(classifySaveResponseStatus(200)).toBe("saved");
    expect(classifySaveResponseStatus(204)).toBe("saved");
  });

  it("treats 409 as a conflict", () => {
    expect(classifySaveResponseStatus(409)).toBe("conflict");
  });

  it("treats other non-2xx statuses as an error", () => {
    expect(classifySaveResponseStatus(400)).toBe("error");
    expect(classifySaveResponseStatus(404)).toBe("error");
    expect(classifySaveResponseStatus(500)).toBe("error");
  });
});
