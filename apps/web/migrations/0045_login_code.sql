-- Reported: "Det er underligt, at jeg skal logge ind via Telegram forfra hver gang ... Det er som om, jeg bliver logget ind i Telegrams egen browser."
-- Saga's link opens in Telegram's own browser, which has its own cookies - so the login never reached the member's usual browser.
-- Saga now sends a code with the link, typed on the login page in whichever browser the member uses. The code lives on the link's row:
-- one use, the same 15 minutes, and using one of the two ends the other.
ALTER TABLE cockpit_login_links ADD COLUMN code_hash TEXT;
CREATE INDEX idx_cockpit_login_links_code ON cockpit_login_links(code_hash);
