import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// holistisk.org portal: points the staging environment of apps/holistisk/wrangler.jsonc at its own D1 database.
// Never touches apps/web (Hjerterum).
const databaseId = process.argv[2];
if (!databaseId || !/^[0-9a-f-]{36}$/i.test(databaseId)) {
  process.stderr.write("A D1 database id is required.\n");
  process.exit(2);
}

const configPath = resolve("apps/holistisk/wrangler.jsonc");
const config = JSON.parse(await readFile(configPath, "utf8"));
const staging = config.env?.staging;
if (!staging) {
  process.stderr.write("apps/holistisk/wrangler.jsonc has no staging environment.\n");
  process.exit(2);
}
staging.d1_databases = [
  {
    binding: "DB",
    database_name: "holistisk-portal-staging",
    database_id: databaseId,
    migrations_dir: "migrations"
  }
];
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write("Configured holistisk staging D1 binding.\n");
