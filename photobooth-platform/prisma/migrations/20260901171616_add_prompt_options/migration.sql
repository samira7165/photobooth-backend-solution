-- AlterTable
ALTER TABLE `submissions` ADD COLUMN `promptOptionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `prompt_options` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `prompt` TEXT NOT NULL,
    `thumbnailUrl` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `prompt_options_campaignId_idx`(`campaignId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `submissions_promptOptionId_idx` ON `submissions`(`promptOptionId`);

-- AddForeignKey
ALTER TABLE `prompt_options` ADD CONSTRAINT `prompt_options_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_promptOptionId_fkey` FOREIGN KEY (`promptOptionId`) REFERENCES `prompt_options`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

