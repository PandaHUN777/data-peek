import type { SchemaIntelCheckId, SchemaIntelSeverity } from "@shared/index";

export const ALL_CHECK_IDS: readonly SchemaIntelCheckId[] = [
  "tables_without_pk",
  "missing_fk_indexes",
  "duplicate_indexes",
  "unused_indexes",
  "invalid_indexes",
  "bloated_tables",
  "never_vacuumed",
  "nullable_fks",
];

const SEVERITIES: readonly SchemaIntelSeverity[] = [
  "info",
  "warning",
  "critical",
];

export interface DoctorOptions {
  connectionString: string | undefined;
  checks: SchemaIntelCheckId[] | undefined;
  json: boolean;
  failOn: SchemaIntelSeverity | undefined;
  color: boolean;
}

export type ParsedArgs =
  | { command: "help" }
  | { command: "version" }
  | { command: "doctor"; options: DoctorOptions }
  | { command: "error"; message: string };

function isCheckId(value: string): value is SchemaIntelCheckId {
  return (ALL_CHECK_IDS as readonly string[]).includes(value);
}

function isSeverity(value: string): value is SchemaIntelSeverity {
  return (SEVERITIES as readonly string[]).includes(value);
}

/**
 * Pure argv parser. Takes argv with the node binary and script path already
 * stripped. Never reads process.env; the caller resolves DATABASE_URL so this
 * stays testable.
 */
export function parseArgs(
  argv: readonly string[],
  env: { DATABASE_URL?: string } = {},
): ParsedArgs {
  const [command, ...rest] = argv;

  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    return { command: "help" };
  }
  if (command === "version" || command === "--version" || command === "-v") {
    return { command: "version" };
  }
  if (command !== "doctor") {
    return {
      command: "error",
      message: `Unknown command "${command}". Try: data-peek doctor`,
    };
  }

  const options: DoctorOptions = {
    connectionString: undefined,
    checks: undefined,
    json: false,
    failOn: undefined,
    color: true,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const [flag, inlineValue] =
      arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg];
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("-")) return undefined;
      i++;
      return next;
    };

    switch (flag) {
      case "--json":
        options.json = true;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--checks": {
        const value = takeValue();
        if (!value)
          return {
            command: "error",
            message: "--checks needs a comma-separated list",
          };
        const ids = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = ids.filter((id) => !isCheckId(id));
        if (unknown.length) {
          return {
            command: "error",
            message: `Unknown check${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}\nAvailable: ${ALL_CHECK_IDS.join(", ")}`,
          };
        }
        options.checks = ids.filter(isCheckId);
        break;
      }
      case "--fail-on": {
        const value = takeValue();
        if (!value || !isSeverity(value)) {
          return {
            command: "error",
            message: "--fail-on must be one of: info, warning, critical",
          };
        }
        options.failOn = value;
        break;
      }
      case "--help":
      case "-h":
        return { command: "help" };
      default:
        if (arg.startsWith("-")) {
          return { command: "error", message: `Unknown flag "${arg}"` };
        }
        if (options.connectionString) {
          return {
            command: "error",
            message: "Only one connection string is accepted",
          };
        }
        options.connectionString = arg;
    }
  }

  if (!options.connectionString && env.DATABASE_URL) {
    options.connectionString = env.DATABASE_URL;
  }

  return { command: "doctor", options };
}

export const HELP = `data-peek — schema checks from the terminal

Usage
  data-peek doctor <connection-string> [options]
  DATABASE_URL=postgres://… data-peek doctor

Options
  --checks <a,b,c>     Run only these checks (default: all)
  --json               Print the raw report as JSON
  --fail-on <level>    Exit 1 if any finding is at or above: info | warning | critical
  --no-color           Plain output
  -h, --help           Show this help
  -v, --version        Show the version

Checks
  tables_without_pk    Tables with no primary key
  missing_fk_indexes   Foreign keys with no supporting index
  duplicate_indexes    Indexes that cover the same columns
  unused_indexes       Indexes over 1 MB with idx_scan = 0
  invalid_indexes      Indexes left invalid by a failed CONCURRENTLY build
  bloated_tables       Tables over 20% dead tuples
  never_vacuumed       Tables with no vacuum or analyze on record
  nullable_fks         Foreign key columns that allow NULL

Postgres only for now. Read-only catalog queries, one connection, nothing leaves your machine.
Open the same connection in data-peek (https://datapeek.dev) to apply fixes with a click.
`;
