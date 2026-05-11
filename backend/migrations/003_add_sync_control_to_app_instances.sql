-- Run this after 002_add_user_identity_links.sql
-- Adds per-installation sync control flags for dashboard actions.

ALTER TABLE app_instances
    ADD COLUMN desired_sync_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER last_seen_at,
    ADD COLUMN sync_override_updated_at TIMESTAMP NULL DEFAULT NULL AFTER desired_sync_enabled;
