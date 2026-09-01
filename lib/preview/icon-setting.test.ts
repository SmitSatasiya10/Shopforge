import { describe, it, expect } from "vitest";
import { filledIconSettingId, isIconSettingId } from "./icon-setting";

describe("isIconSettingId", () => {
  it("matches the icon/icon_N naming convention", () => {
    expect(isIconSettingId("icon")).toBe(true);
    expect(isIconSettingId("icon_1")).toBe(true);
    expect(isIconSettingId("icon_12")).toBe(true);
  });

  it("rejects unrelated or look-alike ids", () => {
    expect(isIconSettingId("collapse_icon")).toBe(false);
    expect(isIconSettingId("custom_icon")).toBe(false);
    expect(isIconSettingId("btn_icon")).toBe(false);
    expect(isIconSettingId("icon_")).toBe(false);
    expect(isIconSettingId("iconx")).toBe(false);
    expect(isIconSettingId("")).toBe(false);
  });
});

describe("filledIconSettingId", () => {
  it("derives the sibling filled-state setting id", () => {
    expect(filledIconSettingId("icon")).toBe("filled_icon");
    expect(filledIconSettingId("icon_2")).toBe("filled_icon_2");
  });
});
