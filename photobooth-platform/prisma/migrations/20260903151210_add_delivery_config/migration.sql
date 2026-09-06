-- AlterTable
ALTER TABLE `campaigns` ADD COLUMN `deliveryConfig` JSON NULL;

-- AlterTable
ALTER TABLE `submissions` ADD COLUMN `displayCode` VARCHAR(191) NULL,
    ADD COLUMN `downloadCodeExpiresAt` DATETIME(3) NULL;

