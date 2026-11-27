-- The chair (27 Nov 2026): "alle forbindelser til holistisk og membership works skal klippes". The kept calendar (house_events) no longer links to
-- holistisk.org: an event from MembershipWorks has its own page on hjerterum.info (event-detail.ts), anything else no link.
UPDATE house_events SET link = CASE
  WHEN length(id) = 26 AND substr(id, 1, 2) = 'SF' THEN 'https://www.hjerterum.info/events/' || substr(id, 3)
  ELSE NULL END;
