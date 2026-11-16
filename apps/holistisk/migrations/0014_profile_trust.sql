-- Light trust on a member's profile, without any ID check: a mark for a confirmed e-mail and a clear yes to showing the
-- photo. ("Har været med" needs no column: it is counted from the flocks the member has been with.)

-- When the member last logged in with a link sent to the e-mail on their profile. Changing the e-mail clears it.
ALTER TABLE members ADD COLUMN email_verified_at INTEGER;

-- Members who have already used a login link to the e-mail on their profile.
UPDATE members SET email_verified_at = (
  SELECT MIN(l.used_at) FROM login_links l WHERE l.used_at IS NOT NULL AND lower(l.email) = lower(members.email)
) WHERE email IS NOT NULL;

-- When the member said yes to "Mit billede må ses af andre i mine flokke". A new photo is only saved with that yes.
-- Photos uploaded before had the same promise written beside the field (only those in your flocks see it).
ALTER TABLE member_photos ADD COLUMN consent_at INTEGER;
UPDATE member_photos SET consent_at = updated_at;
