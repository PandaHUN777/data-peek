import pg from "pg";
import pc from "picocolors";
import { runPostgresSchemaIntel } from "@shared/schema-intel/postgres";
import type { DoctorOptions } from "./args";
import { atOrAbove, formatReport, PLAIN, type Palette } from "./format";

export interface DoctorResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

const SUPPORTED_SCHEMES = new Set(["postgres:", "postgresql:"]);
const KNOWN_OTHER: Record<string, string> = {
  "mysql:": "MySQL",
  "mysql2:": "MySQL",
  "mssql:": "SQL Server",
  "sqlserver:": "SQL Server",
  "sqlite:": "SQLite",
  "file:": "SQLite",
};

function describeTarget(connectionString: string): {
  database: string;
  host: string;
} {
  try {
    const url = new URL(connectionString);
    return {
      database: url.pathname.replace(/^\//, "") || "(default)",
      host: url.port
        ? `${url.hostname}:${url.port}`
        : url.hostname || "localhost",
    };
  } catch {
    return { database: "(unknown)", host: "(unknown)" };
  }
}

function schemeOf(connectionString: string): string | null {
  try {
    return new URL(connectionString).protocol;
  } catch {
    return null;
  }
}

/**
 * Node wraps a refused connection in an AggregateError whose own message is
 * empty, with the real reason on `errors[0]`. Prefer the code, then the message.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0)
    return describeError(err.errors[0]);
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && err.message && !err.message.includes(code))
      return `${code} ${err.message}`;
    return err.message || code || err.name;
  }
  return String(err);
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  if (!options.connectionString) {
    return {
      exitCode: 2,
      stdout: "",
      stderr:
        "No connection string. Pass one as the first argument or set DATABASE_URL.\n" +
        "  data-peek doctor postgres://user:pass@host:5432/db",
    };
  }

  const scheme = schemeOf(options.connectionString);
  if (scheme && !SUPPORTED_SCHEMES.has(scheme)) {
    const name = KNOWN_OTHER[scheme] ?? scheme.replace(":", "");
    return {
      exitCode: 2,
      stdout: "",
      stderr:
        `${name} isn't supported by doctor yet. Postgres only for now.\n` +
        "The desktop app runs schema checks on MySQL and SQL Server: https://datapeek.dev",
    };
  }

  const palette: Palette = options.color && !options.json ? pc : PLAIN;
  const client = new pg.Client({
    connectionString: options.connectionString,
    application_name: "data-peek doctor",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
  });

  try {
    await client.connect();
  } catch (err) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `Could not connect: ${describeError(err)}`,
    };
  }

  try {
    const report = await runPostgresSchemaIntel(client, options.checks);
    const failing =
      options.failOn !== undefined &&
      report.findings.some((f) =>
        atOrAbove(
          f.severity,
          options.failOn as NonNullable<typeof options.failOn>,
        ),
      );

    const stdout = options.json
      ? JSON.stringify(report, null, 2)
      : formatReport(report, {
          ...describeTarget(options.connectionString),
          palette,
        });

    return { exitCode: failing ? 1 : 0, stdout };
  } finally {
    await client.end().catch(() => undefined);
  }
}
