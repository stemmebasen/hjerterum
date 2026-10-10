-- Requested: "Vi skal ikke bruge folks adresser. Men gerne fødselsdag, så vi kan lave noget omkring deres stjernetegn på et tidspunkt."
-- The birthday as YYYY-MM-DD, given by the member. street_address is no longer asked for or shown.
ALTER TABLE members ADD COLUMN birthday TEXT;
