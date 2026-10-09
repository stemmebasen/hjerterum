-- Requested: "Man skal også kunne tildele hver mail til et medlem af bestyrelsen": who has the mail, and the to-do it became.
ALTER TABLE board_mail ADD COLUMN assigned_to TEXT;
ALTER TABLE board_mail ADD COLUMN assigned_todo_id INTEGER;
