-- Reported (Douglas): "in the 'Critical mails' section of the 'Mailbox', there are 9 long emails from Mailchimp that were activated because
-- I was helping Gitta with the newsletter. They can be ignored." Mail from Mailchimp (and the services that send for it) is automatic,
-- never critical (cockpit/enquiries.ts isAutomatic) - and the ones already marked are put right.
UPDATE board_mail SET urgent_why = NULL, urgent_notified_ms = COALESCE(urgent_notified_ms, 0), label = 'Automatisk'
WHERE lower(sender) LIKE '%mailchimp%' OR lower(sender) LIKE '%@mcsv.net%' OR lower(sender) LIKE '%@mcdlv.net%' OR lower(sender) LIKE '%@rsgsv.net%'
   OR lower(sender) LIKE '%list-manage.com%' OR lower(sender) LIKE '%mandrillapp.com%' OR lower(sender) LIKE '%@intuit.com%';
