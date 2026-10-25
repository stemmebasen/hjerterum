import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const databaseId = process.argv[2];
// The environment and database to bind: staging by default, "test hjerterum-test" for the test site.
const environment = process.argv[3] ?? "staging";
const databaseName = process.argv[4] ?? "hjerterum-staging";
if (!databaseId) {
  process.stderr.write("D1 database id is required.\n");
  process.exit(2);
}

const configPath = resolve("apps/web/wrangler.jsonc");
const source = await readFile(configPath, "utf8");
const config = JSON.parse(source);

config.env ??= {};
config.env[environment] ??= {};
config.env[environment].d1_databases = [
  {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "migrations"
  }
];

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write(`Configured ${environment} D1 binding.\n`);
