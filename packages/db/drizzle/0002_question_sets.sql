CREATE TABLE `question_sets` (
	`category_id` varchar(120) NOT NULL,
	`basis` enum('mined','insights','estimated') NOT NULL,
	`set` json NOT NULL,
	`note` text NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `question_sets_category_id` PRIMARY KEY(`category_id`)
);
