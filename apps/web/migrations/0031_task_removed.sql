-- Requested: "make sure that there are no duplicates in the to-dos. Right now, it's quite a mess, and I can't delete
-- them." A task from the minutes, or one Saga found, can be removed from a member's own list: kept as a check marked
-- removed, so it is neither open nor shown as done - and never as done on the board's shared list.
ALTER TABLE cockpit_task_checks ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
