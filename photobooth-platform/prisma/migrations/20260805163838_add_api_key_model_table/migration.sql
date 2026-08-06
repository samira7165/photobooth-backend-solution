-- CreateTable
CREATE TABLE `api_key_models` (
    `id` VARCHAR(191) NOT NULL,
    `apiKeyId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `api_key_models_apiKeyId_idx`(`apiKeyId`),
    UNIQUE INDEX `api_key_models_apiKeyId_model_key`(`apiKeyId`, `model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_key_models` ADD CONSTRAINT `api_key_models_apiKeyId_fkey` FOREIGN KEY (`apiKeyId`) REFERENCES `api_keys`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: preserve any model name already set on api_keys.model as that
-- key's first ApiKeyModel row, before the column is dropped below.
INSERT INTO `api_key_models` (`id`, `apiKeyId`, `model`, `createdAt`)
SELECT UUID(), `id`, `model`, NOW(3)
FROM `api_keys`
WHERE `model` IS NOT NULL AND `model` != '';

-- AlterTable
ALTER TABLE `api_keys` DROP COLUMN `model`;
