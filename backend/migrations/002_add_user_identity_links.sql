-- Run this after 001_create_tables.sql
-- Adds account-level identity tables and links telemetry events to users.

CREATE TABLE IF NOT EXISTS users (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username     VARCHAR(120) NOT NULL,
    name         VARCHAR(120) NULL,
    surname      VARCHAR(120) NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_instances (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    instance_id   CHAR(36) NOT NULL,
    user_id       BIGINT UNSIGNED NOT NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_instances_instance_user (instance_id, user_id),
    KEY idx_user_instances_user_id (user_id),
    CONSTRAINT fk_user_instances_instance_id
      FOREIGN KEY (instance_id)
      REFERENCES app_instances (instance_id)
      ON DELETE CASCADE,
    CONSTRAINT fk_user_instances_user_id
      FOREIGN KEY (user_id)
      REFERENCES users (id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_event_users (
    event_id   CHAR(36) NOT NULL,
    user_id    BIGINT UNSIGNED NOT NULL,
    linked_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id),
    KEY idx_activity_event_users_user_id (user_id),
    CONSTRAINT fk_activity_event_users_event_id
      FOREIGN KEY (event_id)
      REFERENCES activity_events (event_id)
      ON DELETE CASCADE,
    CONSTRAINT fk_activity_event_users_user_id
      FOREIGN KEY (user_id)
      REFERENCES users (id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User-based analytics views
CREATE OR REPLACE VIEW dau_named_users AS
    SELECT DATE(ae.event_time) AS day,
           COUNT(DISTINCT aeu.user_id) AS active_users
    FROM activity_events ae
    INNER JOIN activity_event_users aeu ON aeu.event_id = ae.event_id
    GROUP BY DATE(ae.event_time);

CREATE OR REPLACE VIEW mau_named_users AS
    SELECT DATE_FORMAT(ae.event_time, '%Y-%m-01') AS month,
           COUNT(DISTINCT aeu.user_id) AS active_users
    FROM activity_events ae
    INNER JOIN activity_event_users aeu ON aeu.event_id = ae.event_id
    GROUP BY DATE_FORMAT(ae.event_time, '%Y-%m-01');
