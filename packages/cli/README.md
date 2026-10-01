# data-peek

Schema checks for Postgres from the terminal. Nothing to install.

```bash
npx data-peek doctor postgres://user:pass@localhost:5432/app
```

```
data-peek doctor  app @ localhost:5432

✖ critical  public.idx_orders_email is invalid
            Invalid indexes are ignored by the planner. Drop and recreate with CREATE INDEX CONCURRENTLY.
            DROP INDEX "public"."idx_orders_email";

▲ warning   public.payments(invoice_id) is a FK without a supporting index
            Deletes on the parent table and joins over this foreign key scan the whole child table. Add a matching index.
            CREATE INDEX "idx_payments_invoice_id" ON "public"."payments" ("invoice_id");

● info      public.events is 41.2% dead tuples
            Consider running VACUUM on this table.
            VACUUM (ANALYZE, VERBOSE) "public"."events";

3 findings (1 critical, 1 warning, 1 info) · ran in 31 ms
```

Every finding comes with the SQL that fixes it.

## Checks

| Check                | What it finds                                                       | Severity |
| -------------------- | ------------------------------------------------------------------- | -------- |
| `tables_without_pk`  | Tables with no primary key                                          | warning  |
| `missing_fk_indexes` | Foreign keys whose columns are not the leading columns of any index | warning  |
| `duplicate_indexes`  | Indexes with identical definitions on the same table                | warning  |
| `unused_indexes`     | Indexes over 1 MB with `idx_scan = 0` since the last stats reset    | info     |
| `invalid_indexes`    | Indexes left invalid by a failed `CREATE INDEX CONCURRENTLY`        | critical |
| `bloated_tables`     | Tables with over 20 % dead tuples (from `n_dead_tup`, an estimate)  | info     |
| `never_vacuumed`     | Tables over 1,000 rows with no vacuum or analyze on record          | info     |
| `nullable_fks`       | Foreign key columns that allow `NULL`                               | info     |

All checks are read-only queries against the system catalogs. No extensions are needed. One connection is opened and closed. Nothing leaves your machine.

## Options

```
data-peek doctor <connection-string> [options]

  --checks <a,b,c>     Run only these checks (default: all)
  --json               Print the raw report as JSON
  --fail-on <level>    Exit 1 if any finding is at or above: info | warning | critical
  --no-color           Plain output (also honours NO_COLOR)
```

With no connection string, `DATABASE_URL` is used.

## As a CI gate

Fail the build when a migration drops a foreign key's index or leaves one invalid:

```yaml
- name: Schema checks
  run: npx data-peek doctor "$DATABASE_URL" --fail-on warning
```

Exit codes: `0` clean or below threshold, `1` findings at or above `--fail-on`, `2` usage or connection error.

## Postgres only, for now

MySQL and SQL Server connection strings print a clear message rather than a partial answer. The [data-peek desktop app](https://datapeek.dev) runs schema checks on all three.

## Same checks as the app

These queries are the ones behind Schema Intel in the data-peek desktop app, imported from the same file. Open the connection in the app and the same findings are there, with the fix one click away.

MIT. Source: [github.com/Rohithgilla12/data-peek](https://github.com/Rohithgilla12/data-peek/tree/main/packages/cli)
