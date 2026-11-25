-- Public AI runtime allowance counter (single row).
-- Every model attempt reserves one unit via an atomic conditional UPDATE
-- before the provider call; the cap lives in ALLOWANCE_CAP.
CREATE TABLE IF NOT EXISTS allowance (
  id INTEGER PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO allowance (id, used) VALUES (1, 0);
