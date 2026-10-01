// The Postgres checks live in the shared package so the `data-peek` CLI
// (`npx data-peek doctor`) and the desktop app run the exact same queries.
export { runPostgresSchemaIntel } from '@shared/schema-intel/postgres'
