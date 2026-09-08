const databaseName = process.argv[2];
if (!databaseName) {
  process.stderr.write("Database name is required.\n");
  process.exit(2);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

let parsed;
try {
  parsed = JSON.parse(input);
} catch {
  process.stderr.write("Could not parse Wrangler D1 list JSON.\n");
  process.exit(2);
}

const candidates = Array.isArray(parsed)
  ? parsed
  : Array.isArray(parsed?.result)
    ? parsed.result
    : Array.isArray(parsed?.databases)
      ? parsed.databases
      : [];

const database = candidates.find((candidate) => {
  const name = candidate?.name ?? candidate?.database_name;
  return name === databaseName;
});

const id = database?.uuid ?? database?.database_id ?? database?.id;
if (typeof id === "string" && id.length > 0) {
  process.stdout.write(id);
}
