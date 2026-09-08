import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const databaseId = process.argv[2];
if (!databaseId) {
  process.stderr.write("D1 database id is required.\n");
  process.exit(2);
}

const configPath = resolve("apps/web/wrangler.jsonc");
const source = await readFile(configPath, "utf8");
const config = JSON.parse(source);

config.env ??= {};
config.env.staging ??= {};
config.env.staging.d1_databases = [
  {
    binding: "DB",
    database_name: "hjerterum-staging",
    database_id: databaseId,
    migrations_dir: "migrations"
  }
];

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write("Configured staging D1 binding.\n");
