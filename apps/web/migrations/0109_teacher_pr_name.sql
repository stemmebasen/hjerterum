-- Asked by Mari-Anne (25 Nov 2026), through the chair: "Måske kan I ændre de fremtidige posts til 'Yin Yoga med Yin Yogi'?" A teacher's own name in
-- Hjerterum's posts, films, posters and newsletter (teacher-names.ts), set on the teacher's card in admin → Events → Undervisere. Keyed as
-- cockpit_teachers (the name in lower case), but kept apart, so a name here does not make a teacher of its own.
CREATE TABLE IF NOT EXISTS teacher_pr_names (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pr_name TEXT NOT NULL,
  updated_by TEXT,
  updated_at_ms INTEGER NOT NULL
);

INSERT INTO teacher_pr_names (key, name, pr_name, updated_by, updated_at_ms) VALUES ('mari-anne christoffersen', 'Mari-Anne Christoffersen', 'Yin Yogi', 'Mari-Anne (via formanden, 25. nov. 2026)', 1795651200000)
  ON CONFLICT(key) DO UPDATE SET pr_name = excluded.pr_name;
