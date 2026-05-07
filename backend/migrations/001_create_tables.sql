-- Run this once in your MySQL database (putitdb9l2p6_saveToServer)
-- via cPanel phpMyAdmin

-- Tracks each unique installation of the desktop app
CREATE TABLE IF NOT EXISTS app_instances (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    instance_id   CHAR(36) NOT NULL,
    app_version   VARCHAR(20) NULL,
    os            VARCHAR(50) NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_instances_instance_id (instance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks activity events sent from the desktop app
CREATE TABLE IF NOT EXISTS activity_events (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id     CHAR(36) NOT NULL,
    instance_id  CHAR(36) NOT NULL,
    event_type   VARCHAR(50) NOT NULL,
    app_version  VARCHAR(20) NULL,
    os           VARCHAR(50) NULL,
    event_time   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata     JSON NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_activity_events_event_id (event_id),
    KEY idx_activity_events_instance_id (instance_id),
    KEY idx_activity_events_event_time (event_time),
    KEY idx_activity_events_event_type (event_type),
    CONSTRAINT fk_activity_events_instance_id
      FOREIGN KEY (instance_id)
      REFERENCES app_instances (instance_id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Useful analytics views
CREATE OR REPLACE VIEW dau AS
    SELECT DATE(event_time) AS day,
           COUNT(DISTINCT instance_id) AS active_users
    FROM activity_events
    GROUP BY DATE(event_time);

CREATE OR REPLACE VIEW mau AS
    SELECT DATE_FORMAT(event_time, '%Y-%m-01') AS month,
           COUNT(DISTINCT instance_id) AS active_users
    FROM activity_events
    GROUP BY DATE_FORMAT(event_time, '%Y-%m-01');
