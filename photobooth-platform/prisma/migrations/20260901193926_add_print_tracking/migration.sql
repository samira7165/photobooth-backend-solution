-- AlterTable
ALTER TABLE `submissions` ADD COLUMN `printAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `printError` TEXT NULL,
    ADD COLUMN `printStatus` ENUM('NOT_PRINTED', 'PRINT_REQUESTED', 'PRINTING', 'PRINTED', 'FAILED') NOT NULL DEFAULT 'NOT_PRINTED',
    ADD COLUMN `printedAt` DATETIME(3) NULL,
    ADD COLUMN `printerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `submissions_printStatus_idx` ON `submissions`(`printStatus`);

