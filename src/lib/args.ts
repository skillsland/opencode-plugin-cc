export type ParsedArgs = {
  options: Record<string, string | boolean>;
  positionals: string[];
};

export type ParseArgsConfig = {
  valueOptions?: string[];
  booleanOptions?: string[];
  aliasMap?: Record<string, string>;
};

function normalizeOptionName(
  name: string,
  aliasMap: Record<string, string>,
): string {
  return aliasMap[name] ?? name;
}

function expectsValue(
  name: string,
  config: Required<ParseArgsConfig>,
): boolean {
  return config.valueOptions.includes(name);
}

function expectsBoolean(
  name: string,
  config: Required<ParseArgsConfig>,
): boolean {
  return config.booleanOptions.includes(name);
}

function setOption(
  options: Record<string, string | boolean>,
  name: string,
  value: string | boolean,
): void {
  options[name] = value;
}

export function parseArgs(
  argv: string[],
  config: ParseArgsConfig = {},
): ParsedArgs {
  const normalizedConfig: Required<ParseArgsConfig> = {
    valueOptions: config.valueOptions ?? [],
    booleanOptions: config.booleanOptions ?? [],
    aliasMap: config.aliasMap ?? {},
  };
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token == null) {
      continue;
    }
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equalsIndex = body.indexOf("=");
      const rawName = equalsIndex === -1 ? body : body.slice(0, equalsIndex);
      const name = normalizeOptionName(rawName, normalizedConfig.aliasMap);
      if (!name) {
        continue;
      }
      if (equalsIndex !== -1) {
        setOption(options, name, body.slice(equalsIndex + 1));
        continue;
      }
      if (expectsBoolean(name, normalizedConfig)) {
        setOption(options, name, true);
        continue;
      }
      if (expectsValue(name, normalizedConfig)) {
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`Missing value for --${name}.`);
        }
        setOption(options, name, value);
        index += 1;
        continue;
      }
      setOption(options, name, true);
      continue;
    }

    const shortFlags = token.slice(1);
    for (let flagIndex = 0; flagIndex < shortFlags.length; flagIndex += 1) {
      const rawName = shortFlags[flagIndex] ?? "";
      const name = normalizeOptionName(rawName, normalizedConfig.aliasMap);
      if (expectsValue(name, normalizedConfig)) {
        const inline = shortFlags.slice(flagIndex + 1);
        if (inline) {
          setOption(options, name, inline);
          break;
        }
        const value = argv[index + 1];
        if (value == null) {
          throw new Error(`Missing value for -${rawName}.`);
        }
        setOption(options, name, value);
        index += 1;
        break;
      }
      setOption(options, name, true);
    }
  }

  return { options, positionals };
}

export function splitRawArgumentString(raw: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (quote === char) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (quote !== null) {
    throw new Error("Unterminated quote in arguments.");
  }
  if (current) {
    result.push(current);
  }
  return result;
}

export function normalizeArgv(argv: string[]): string[] {
  if (argv.length !== 1) {
    return argv;
  }
  const [raw] = argv;
  if (raw == null) {
    return [];
  }
  if (!raw.trim()) {
    return [];
  }
  return splitRawArgumentString(raw);
}
