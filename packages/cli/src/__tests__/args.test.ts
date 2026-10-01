import { describe, expect, it } from "vitest";
import { parseArgs } from "../args";

describe("parseArgs", () => {
  it("shows help with no command", () => {
    expect(parseArgs([])).toEqual({ command: "help" });
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
  });

  it("rejects unknown commands", () => {
    const parsed = parseArgs(["heal"]);
    expect(parsed.command).toBe("error");
  });

  it("takes the connection string positionally", () => {
    const parsed = parseArgs(["doctor", "postgres://a:b@h/db"]);
    expect(parsed).toMatchObject({
      command: "doctor",
      options: {
        connectionString: "postgres://a:b@h/db",
        json: false,
        color: true,
      },
    });
  });

  it("falls back to DATABASE_URL", () => {
    const parsed = parseArgs(["doctor"], { DATABASE_URL: "postgres://env/db" });
    expect(parsed).toMatchObject({
      options: { connectionString: "postgres://env/db" },
    });
  });

  it("prefers the positional argument over DATABASE_URL", () => {
    const parsed = parseArgs(["doctor", "postgres://arg/db"], {
      DATABASE_URL: "postgres://env/db",
    });
    expect(parsed).toMatchObject({
      options: { connectionString: "postgres://arg/db" },
    });
  });

  it("parses --checks as a list, in both flag styles", () => {
    expect(
      parseArgs(["doctor", "x", "--checks", "unused_indexes,bloated_tables"]),
    ).toMatchObject({
      options: { checks: ["unused_indexes", "bloated_tables"] },
    });
    expect(parseArgs(["doctor", "x", "--checks=nullable_fks"])).toMatchObject({
      options: { checks: ["nullable_fks"] },
    });
  });

  it("rejects unknown check ids and names them", () => {
    const parsed = parseArgs([
      "doctor",
      "x",
      "--checks",
      "unused_indexes,nope",
    ]);
    expect(parsed.command).toBe("error");
    if (parsed.command === "error") expect(parsed.message).toContain("nope");
  });

  it("parses --fail-on and rejects bad levels", () => {
    expect(parseArgs(["doctor", "x", "--fail-on", "warning"])).toMatchObject({
      options: { failOn: "warning" },
    });
    expect(parseArgs(["doctor", "x", "--fail-on", "fatal"]).command).toBe(
      "error",
    );
    expect(parseArgs(["doctor", "x", "--fail-on"]).command).toBe("error");
  });

  it("parses --json and --no-color", () => {
    expect(parseArgs(["doctor", "x", "--json", "--no-color"])).toMatchObject({
      options: { json: true, color: false },
    });
  });

  it("rejects a second positional", () => {
    expect(parseArgs(["doctor", "a", "b"]).command).toBe("error");
  });
});
