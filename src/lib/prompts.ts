import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir: string, name: string): string {
  return fs.readFileSync(path.join(rootDir, "prompts", `${name}.md`), "utf8");
}

export function interpolateTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}
