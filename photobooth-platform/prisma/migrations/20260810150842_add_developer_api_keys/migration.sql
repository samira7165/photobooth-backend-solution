-- AlterTable
ALTER TABLE `campaigns` ADD COLUMN `allowedOrigins` JSON NULL;

-- CreateTable
CREATE TABLE `developer_api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `keyPrefix` VARCHAR(191) NOT NULL,
    `keyHash` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `allowedOrigins` JSON NULL,
    `rateLimit` INTEGER NOT NULL DEFAULT 60,
    `usageToday` INTEGER NOT NULL DEFAULT 0,
    `usageTotal` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `developer_api_keys_campaignId_idx`(`campaignId`),
    INDEX `developer_api_keys_keyPrefix_idx`(`keyPrefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `developer_api_keys` ADD CONSTRAINT `developer_api_keys_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

