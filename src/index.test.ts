import { describe, expect, it } from "vitest";

import ClaudeCodePlugin, {
  ClaudeCodePlugin as namedPlugin,
  pluginName,
} from "./index.js";

describe("ClaudeCodePlugin", () => {
  it("exports a named and default OpenCode plugin", () => {
    expect(pluginName).toBe("opencode-plugin-cc");
    expect(ClaudeCodePlugin).toBe(namedPlugin);
    expect(ClaudeCodePlugin).toBeTypeOf("function");
  });
});
