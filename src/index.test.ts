import { describe, expect, it } from "vitest";

import plugin, { pluginDescription, pluginName } from "./index.js";

describe("package metadata", () => {
  it("exports stable plugin metadata", () => {
    expect(pluginName).toBe("opencode-plugin-cc");
    expect(pluginDescription).toContain("OpenCode");
    expect(plugin).toEqual({
      name: pluginName,
      description: pluginDescription,
    });
  });
});
