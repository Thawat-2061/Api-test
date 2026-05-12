-- ============================================================
-- Schema Setup
-- Run: docker exec -i <container> mysql -u root -p<pass> < schema.sql
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- Tier 1: No dependencies
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `role` varchar(100) NOT NULL,
  `password` varchar(100) NOT NULL,
  `imageURL` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `people` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `permission_group` enum('Artist','Viewer') DEFAULT 'Artist',
  `groups_name` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `pipeline_steps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` enum('asset','shot') NOT NULL,
  `step_name` varchar(100) NOT NULL,
  `step_code` varchar(50) NOT NULL,
  `color_hex` varchar(7) NOT NULL,
  `display_order` int NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_step` (`entity_type`,`step_code`)
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `secret_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `query_type` varchar(20) DEFAULT NULL,
  `query_text` text,
  `status` enum('success','failed') DEFAULT NULL,
  `error_message` text,
  `executed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_executed_at` (`executed_at`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 2: Depends on users
-- ============================================================

CREATE TABLE IF NOT EXISTS `projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `images` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_name` (`project_name`),
  KEY `fk_projects_users` (`created_by`),
  CONSTRAINT `fk_projects_users` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=90 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Tier 3: Depends on projects
-- ============================================================

CREATE TABLE IF NOT EXISTS `project_sequences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `sequence_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `order_index` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `file_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('wtg','ip','fin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'wtg',
  PRIMARY KEY (`id`),
  KEY `project_sequences_ibfk_1_idx` (`project_id`),
  CONSTRAINT `project_sequences_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=111 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_folders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `folder_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  CONSTRAINT `project_folders_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=357 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_viewers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `added_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proj_viewer` (`project_id`,`user_id`),
  KEY `fk_pv_user` (`user_id`),
  CONSTRAINT `fk_pv_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pv_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `files_project` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `download_url` varchar(500) NOT NULL,
  `filename` varchar(255) DEFAULT NULL,
  `storage_path` varchar(500) DEFAULT NULL,
  `type` varchar(50) DEFAULT 'images',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_type` (`project_id`,`type`),
  CONSTRAINT `files_project_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=64 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 4: Depends on projects + project_sequences
-- ============================================================

CREATE TABLE IF NOT EXISTS `project_shots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int DEFAULT NULL,
  `sequence_id` int DEFAULT NULL,
  `shot_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Not Started',
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `order_index` int DEFAULT NULL,
  `file_url` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_sequence_id` (`sequence_id`),
  CONSTRAINT `project_shots_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `project_shots_ibfk_2` FOREIGN KEY (`sequence_id`) REFERENCES `project_sequences` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=143 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `files_sequence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sequence_id` int NOT NULL,
  `download_url` varchar(255) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `type` varchar(50) DEFAULT 'images',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `note_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `files_sequence_ibfk_1` (`sequence_id`),
  CONSTRAINT `files_sequence_ibfk_1` FOREIGN KEY (`sequence_id`) REFERENCES `project_sequences` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=105 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 5: Depends on projects + project_shots + project_sequences
-- ============================================================

CREATE TABLE IF NOT EXISTS `project_assets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int DEFAULT NULL,
  `sequence_id` int DEFAULT NULL,
  `shot_id` int DEFAULT NULL,
  `asset_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'Not Started',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `description` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `order_index` int DEFAULT NULL,
  `file_url` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `taskTemplate` varchar(250) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` enum('Character','Environment','Prop','FX','Graphic','Matte Painting','Vehicle','Weapon','Model','Theme','Zone','Part','No Type') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `fk_project_assets_sequence` (`sequence_id`),
  KEY `fk_project_assets_shot` (`shot_id`),
  CONSTRAINT `fk_project_assets_shot` FOREIGN KEY (`shot_id`) REFERENCES `project_shots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `project_assets_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=143 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Tier 6: Depends on project_assets / project_shots / project_sequences
-- ============================================================

CREATE TABLE IF NOT EXISTS `asset_sequences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_id` int NOT NULL,
  `sequence_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_sequence` (`asset_id`,`sequence_id`),
  KEY `fk_asset_seq_sequence` (`sequence_id`),
  CONSTRAINT `fk_asset_seq_asset` FOREIGN KEY (`asset_id`) REFERENCES `project_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_asset_seq_sequence` FOREIGN KEY (`sequence_id`) REFERENCES `project_sequences` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `asset_shots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_id` int NOT NULL,
  `shot_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_asset_shot` (`asset_id`,`shot_id`),
  KEY `fk_asset_shots_shot` (`shot_id`),
  CONSTRAINT `fk_asset_shots_asset` FOREIGN KEY (`asset_id`) REFERENCES `project_assets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_asset_shots_shot` FOREIGN KEY (`shot_id`) REFERENCES `project_shots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=49 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 7: Depends on projects + pipeline_steps
-- ============================================================

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `entity_type` enum('shot','asset','sequence') DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `task_name` varchar(100) DEFAULT NULL,
  `status` enum('wtg','ip','fin','apr','cmpt','cfrm','nef','dlvr','rts','rev','omt','ren','hld','vwd','crv','na','pndng','cap','recd','chk','rdd','srd','sos') DEFAULT 'wtg',
  `start_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `description` varchar(100) DEFAULT NULL,
  `pipeline_step_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_tasks_project` (`project_id`),
  KEY `tasks_ibfk_1` (`pipeline_step_id`),
  CONSTRAINT `fk_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `tasks_ibfk_1` FOREIGN KEY (`pipeline_step_id`) REFERENCES `pipeline_steps` (`id`) ON DELETE SET NULL ON UPDATE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=530 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 8: Depends on tasks + people
-- ============================================================

CREATE TABLE IF NOT EXISTS `versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `task_id` int DEFAULT NULL,
  `version_number` int NOT NULL,
  `version_name` varchar(150) NOT NULL,
  `file_url` varchar(255) DEFAULT NULL,
  `status` varchar(50) DEFAULT 'wtg',
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `file_size` bigint DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_version` (`entity_type`,`entity_id`,`version_number`),
  UNIQUE KEY `uniq_version_name` (`entity_type`,`entity_id`,`version_name`),
  KEY `idx_entity_version` (`entity_type`,`entity_id`,`version_number`),
  KEY `versions_ibfk_1` (`uploaded_by`),
  KEY `versions_ibfk_2` (`task_id`),
  CONSTRAINT `versions_ibfk_1` FOREIGN KEY (`uploaded_by`) REFERENCES `people` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `versions_ibfk_2` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=409 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `task_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `assigned_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_assignment` (`task_id`,`user_id`),
  KEY `fk_task_assignments_people` (`user_id`),
  CONSTRAINT `fk_task_assignments_people` FOREIGN KEY (`user_id`) REFERENCES `people` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_assignments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=97 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `task_reviewers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `added_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_task_reviewer` (`task_id`,`user_id`),
  KEY `idx_task_id` (`task_id`),
  KEY `fk_task_reviewers_people` (`user_id`),
  CONSTRAINT `fk_task_reviewers_people` FOREIGN KEY (`user_id`) REFERENCES `people` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_task_reviewers_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 9: Depends on versions + project_assets + project_shots
-- ============================================================

CREATE TABLE IF NOT EXISTS `files_asset` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_id` int NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `download_url` text NOT NULL,
  `type` varchar(50) NOT NULL,
  `description` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `version_id` int DEFAULT NULL,
  `note_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_files_asset_asset` (`asset_id`),
  KEY `fk_version_id` (`version_id`),
  CONSTRAINT `fk_files_asset_asset` FOREIGN KEY (`asset_id`) REFERENCES `project_assets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_version_id` FOREIGN KEY (`version_id`) REFERENCES `versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=288 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `files_shot` (
  `id` int NOT NULL AUTO_INCREMENT,
  `shot_id` int NOT NULL,
  `download_url` varchar(500) DEFAULT NULL,
  `file_name` varchar(255) NOT NULL,
  `type` varchar(50) DEFAULT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `version_id` int DEFAULT NULL,
  `note_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_files_shot_shot` (`shot_id`),
  KEY `fk_fs_version_id` (`version_id`),
  CONSTRAINT `fk_files_shot_shot` FOREIGN KEY (`shot_id`) REFERENCES `project_shots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_fs_version_id` FOREIGN KEY (`version_id`) REFERENCES `versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=341 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 10: Depends on asset_shots
-- ============================================================

CREATE TABLE IF NOT EXISTS `files_asset_shot` (
  `id` int NOT NULL AUTO_INCREMENT,
  `asset_shot_id` int NOT NULL,
  `file_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `download_url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `storage_path` text COLLATE utf8mb4_unicode_ci,
  `file_type` enum('work','publish','preview','reference','cache') COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_files_asset_shot` (`asset_shot_id`),
  CONSTRAINT `fk_files_asset_shot` FOREIGN KEY (`asset_shot_id`) REFERENCES `asset_shots` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Tier 11: Depends on projects + people + versions
-- ============================================================

CREATE TABLE IF NOT EXISTS `notes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `note_type` enum('asset','shot','sequence') NOT NULL,
  `type_id` int NOT NULL,
  `subject` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `file_url` varchar(1024) DEFAULT NULL,
  `author` varchar(100) NOT NULL,
  `status` varchar(50) DEFAULT 'open',
  `visibility` enum('Client','Internal') NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `tasks` json DEFAULT NULL,
  `read_status` enum('read','unread') NOT NULL DEFAULT 'unread',
  PRIMARY KEY (`id`),
  KEY `fk_notes_project` (`project_id`),
  CONSTRAINT `fk_notes_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=299 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `video_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `version_id` int NOT NULL,
  `author_id` int NOT NULL,
  `text` text,
  `video_time` float NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `video_comments_ibfk_1` (`version_id`),
  KEY `video_comments_ibfk_2` (`author_id`),
  CONSTRAINT `video_comments_ibfk_1` FOREIGN KEY (`version_id`) REFERENCES `versions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `video_comments_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `people` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 12: Depends on notes + people
-- ============================================================

CREATE TABLE IF NOT EXISTS `note_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `note_id` int DEFAULT NULL,
  `people_id` int DEFAULT NULL,
  `assigned_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_assignment` (`note_id`,`people_id`),
  KEY `note_assignments_ibfk_2` (`people_id`),
  CONSTRAINT `note_assignments_ibfk_1` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `note_assignments_ibfk_2` FOREIGN KEY (`people_id`) REFERENCES `people` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=314 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `note_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `note_id` int NOT NULL,
  `author` varchar(100) NOT NULL,
  `body` text NOT NULL,
  `file_url` varchar(1024) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `note_comments_ibfk_1` (`note_id`),
  CONSTRAINT `note_comments_ibfk_1` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=24 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================
-- Tier 13: Depends on video_comments
-- ============================================================

CREATE TABLE IF NOT EXISTS `video_annotations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `comment_id` int NOT NULL,
  `path_data` json NOT NULL,
  `color` varchar(20) DEFAULT '#FF0000',
  `width` int DEFAULT '3',
  `video_time` float NOT NULL,
  PRIMARY KEY (`id`),
  KEY `video_annotations_ibfk_1` (`comment_id`),
  CONSTRAINT `video_annotations_ibfk_1` FOREIGN KEY (`comment_id`) REFERENCES `video_comments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================

SET FOREIGN_KEY_CHECKS = 1;