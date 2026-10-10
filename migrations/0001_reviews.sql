-- Run once in the D1 console. Re-running does NOT overwrite existing reviews.
-- Dates below are save/publication timestamps, not the date of the trip.
CREATE TABLE IF NOT EXISTS author_reviews (
  id TEXT PRIMARY KEY,
  published_author TEXT NOT NULL DEFAULT '',
  published_half_stars INTEGER CHECK(published_half_stars IS NULL OR (typeof(published_half_stars)='integer' AND published_half_stars BETWEEN 0 AND 10)),
  published_comment TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_revision INTEGER NOT NULL DEFAULT 1,
  draft_author TEXT,
  draft_half_stars INTEGER CHECK(draft_half_stars IS NULL OR (typeof(draft_half_stars)='integer' AND draft_half_stars BETWEEN 0 AND 10)),
  draft_comment TEXT,
  has_draft INTEGER NOT NULL DEFAULT 0 CHECK(has_draft IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT,
  CHECK(length(published_author)<=80 AND length(published_comment)<=10000),
  CHECK(draft_author IS NULL OR length(draft_author)<=80),
  CHECK(draft_comment IS NULL OR length(draft_comment)<=10000)
);
