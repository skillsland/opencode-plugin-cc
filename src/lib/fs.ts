import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readStdinIfPiped(): string {
  if (process.stdin.isTTY) {
    return "";
  }
  try {
    return fs.readFileSync(0, "utf8").trim();
  } catch {
    return "";
  }
}

export function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return false;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const value of sample) {
    if (value < 7 || (value > 14 && value < 32)) {
      suspicious += 1;
    }
  }
  return sample.length === 0 || suspicious / sample.length < 0.05;
}
