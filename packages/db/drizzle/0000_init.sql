CREATE TABLE `api_keys` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`hash` varchar(64) NOT NULL,
	`rate_limit` int NOT NULL DEFAULT 120,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_hash` UNIQUE(`hash`)
);
--> statement-breakpoint
CREATE TABLE `audits` (
	`id` varchar(36) NOT NULL,
	`asin` varchar(16) NOT NULL,
	`requested_asin` varchar(16) NOT NULL,
	`source` enum('serpapi','dataset','paste') NOT NULL,
	`origin` enum('app','api','widget','rescore','bulk') NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL,
	`request` json NOT NULL,
	`score` int,
	`basis` enum('mined','estimated'),
	`category_id` varchar(120),
	`category_name` varchar(200),
	`brand` varchar(200),
	`title` text,
	`content_hash` varchar(64),
	`report` json,
	`usage` json,
	`error` json,
	`note` text,
	`bulk_job_id` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`completed_at` datetime(3),
	CONSTRAINT `audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bulk_jobs` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`source` enum('serpapi','dataset','paste') NOT NULL,
	`total` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `bulk_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`asin` varchar(16) NOT NULL,
	`audit_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listing_snapshots` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`asin` varchar(16) NOT NULL,
	`source` enum('serpapi','dataset','paste') NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`fields` json NOT NULL,
	`meta` json NOT NULL,
	`fetched_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `listing_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `listing_snapshots_hash` UNIQUE(`source`,`asin`,`content_hash`)
);
--> statement-breakpoint
CREATE INDEX `audits_asin_created` ON `audits` (`asin`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_requested_created` ON `audits` (`requested_asin`,`created_at`);--> statement-breakpoint
CREATE INDEX `audits_status` ON `audits` (`status`);--> statement-breakpoint
CREATE INDEX `audits_bulk` ON `audits` (`bulk_job_id`);--> statement-breakpoint
CREATE INDEX `leads_audit` ON `leads` (`audit_id`);