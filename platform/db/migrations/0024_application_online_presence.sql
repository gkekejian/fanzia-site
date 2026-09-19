-- Online presence: where the applicant sells online (Whatnot / TikTok
-- usernames, eBay store links, etc.). Optional free-text field on the
-- apply form so the review screen shows it and the owner decision stays
-- a straight approve/decline.
ALTER TABLE "application" ADD COLUMN "online_presence" text;
