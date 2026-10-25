// A login for one of Flokken's volunteers: prints a personal code (give it to the volunteer, it is shown only here)
// and the SQL that stores its hash as an admin. Run the SQL with wrangler against the database, e.g.
//   node scripts/new-admin.mjs "Sofie" > /tmp/admin.txt
//   wrangler d1 execute holistisk-portal-staging --env staging --remote --command "<the SQL line>"
import { createHash, randomInt, randomUUID } from "node:crypto";

const name = (process.argv[2] ?? "").trim();
if (!/^[\p{L}][\p{L}\p{M}' -]{0,29}$/u.test(name)) {
  console.error('Usage: node scripts/new-admin.mjs "Fornavn"');
  process.exit(1);
}
// The same alphabet and form as src/flokken/auth.ts: no 0/O or 1/I/L.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const code = `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
const hash = createHash("sha256").update(code).digest("hex");
const now = Date.now();
const sqlName = name.replace(/'/g, "''");
console.log(`Code for ${name}: ${code}`);
console.log(`INSERT INTO members (id, first_name, code_hash, created_at, last_seen_at, is_admin) VALUES ('${randomUUID()}', '${sqlName}', '${hash}', ${now}, ${now}, 1);`);
