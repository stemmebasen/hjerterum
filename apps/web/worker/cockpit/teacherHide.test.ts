import { expect, it } from "vitest";
import { listTeachers, setTeacherHidden, teacherKey } from "./teachers.js";
import { testDatabase } from "../saga/test-support.js";

// Requested (Gitta): teachers without contact that are only noise can be removed from the list.
it("hides a teacher without contact, and puts them back", async () => {
  const db = testDatabase(), NOW = Date.parse("2026-10-09T10:00:00Z");
  await db.prepare("INSERT INTO cockpit_teachers (key, name, email, phone, updated_by, updated_at_ms) VALUES (?, 'Støj Person', NULL, NULL, 'x', 1)").bind(teacherKey("Støj Person")).run().catch(() => undefined);
  await db.prepare("INSERT INTO fixed_teachers (email, name, added_by, added_at_ms) VALUES ('f@example.com', 'Fast Lærer', 'x', 1)").run();
  const before = await listTeachers(db, NOW);
  expect(before.find(t => t.name === "Støj Person")?.hidden).toBe(false);
  await setTeacherHidden(db, teacherKey("Støj Person"), true, "Jacob", NOW);
  await setTeacherHidden(db, teacherKey("Fast Lærer"), true, "Jacob", NOW);
  const after = await listTeachers(db, NOW);
  expect(after.find(t => t.name === "Støj Person")?.hidden).toBe(true);
  expect(after.find(t => t.name === "Fast Lærer")?.hidden).toBe(false);
  await setTeacherHidden(db, teacherKey("Støj Person"), false, "Jacob", NOW);
  expect((await listTeachers(db, NOW)).find(t => t.name === "Støj Person")?.hidden).toBe(false);
});
