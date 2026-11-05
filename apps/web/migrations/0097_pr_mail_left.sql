-- Asked (the chair, 5 Nov 2026): "Hvordan sikrer vi os, at der ikke bliver flyttet mails til min mappe, som Lisbeth eller Frederik er i gang med? Der kan
-- jo sagtens indgå de samme keywords." Why Saga left a PR mail in the inbox (another board member has it), shown in PR og SoMe → Mails.
ALTER TABLE board_mail ADD COLUMN pr_left_why TEXT;
