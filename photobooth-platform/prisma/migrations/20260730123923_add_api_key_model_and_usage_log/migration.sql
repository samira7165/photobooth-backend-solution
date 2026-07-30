-- AlterTable
ALTER TABLE `api_keys` ADD COLUMN `model` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `api_key_usage_logs` (
    `id` VARCHAR(191) NOT NULL,
    `apiKeyId` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `responseTime` INTEGER NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_key_usage_logs_apiKeyId_idx`(`apiKeyId`),
    INDEX `api_key_usage_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_key_usage_logs` ADD CONSTRAINT `api_key_usage_logs_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
