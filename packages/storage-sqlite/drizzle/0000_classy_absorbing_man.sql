CREATE TABLE `definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notebook_id` integer NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `definitions_notebook_id_name_unique` ON `definitions` (`notebook_id`,`name`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`definition_id` integer NOT NULL,
	`depends_on_id` integer NOT NULL,
	PRIMARY KEY(`definition_id`, `depends_on_id`),
	FOREIGN KEY (`definition_id`) REFERENCES `definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_id`) REFERENCES `definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notebook_id` integer NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`result` real,
	`error_stage` text,
	`error_message` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evaluations_notebook_at` ON `evaluations` (`notebook_id`,`at`);--> statement-breakpoint
CREATE TABLE `notebooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notebooks_name_unique` ON `notebooks` (`name`);