-- Requested (the chair, 4 Nov 2026): "Jeg har brug for, at Saga finder de mails fra mailboksen, der vedrører PR, deling og sociale medier, at de lander i
-- min undermappe og at de bliver vist i min PR-sektion." When Saga filed a PR mail in "5 - JACOB › PR" (or found it could not), so each is tried once.
ALTER TABLE board_mail ADD COLUMN pr_filed_at_ms INTEGER;
