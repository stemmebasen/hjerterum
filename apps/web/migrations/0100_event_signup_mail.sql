-- Douglas (13 Nov 2026): "a box for the teacher's email address so they can be notified when people book for their event" and "Will there be
-- opportunity for teachers to write a confirmation email for when people sign up for their workshops?" - the chair: "Ja".
-- Whether the organiser gets a mail at each sign-up (on unless they turn it off), and their own words in the participant's confirmation.
ALTER TABLE room_bookings ADD COLUMN notify_signups INTEGER NOT NULL DEFAULT 1;
ALTER TABLE room_bookings ADD COLUMN confirmation_note TEXT;
