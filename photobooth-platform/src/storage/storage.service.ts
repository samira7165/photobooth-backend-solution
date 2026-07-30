import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import { v4 as uuid } from 'uuid';

// Thin wrapper around the S3 client. Registered as @Global() in
// storage.module.ts, so any module can inject this without importing
// StorageModule. Callers (AssetsService, SubmissionsService) check
// isConfigured() first and fall back to local disk when it's false, so
// development works without real AWS credentials.
@Injectable()
export class StorageService {
  private s3: S3Client;
  private bucket: string;
  private logger = new Logger(StorageService.name);

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET');

    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  /**
   * True once real AWS credentials are configured. Callers use this to decide
   * between uploading to S3 and falling back to local disk for development.
   */
  isConfigured(): boolean {
    const accessKey = this.config.get<string>('AWS_ACCESS_KEY_ID');
    return !!accessKey && accessKey !== 'your-aws-access-key-here';
  }

  /**
   * Upload a file to S3.
   * @param buffer - file content
   * @param folder - S3 folder path like "campaigns/shah-cement/originals"
   * @param originalName - original filename for extension detection
   * @param contentType - MIME type
   * @returns S3 key (relative path in bucket)
   */
  async upload(buffer: Buffer, folder: string, originalName: string, contentType: string): Promise<string> {
    const ext = path.extname(originalName) || '.jpg';
    const key = `${folder}/${uuid()}${ext}`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    this.logger.log(`Uploaded: ${key} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return key;
  }

  /**
   * Upload with a specific key (for thumbnails, QR codes, etc.)
   */
  async uploadWithKey(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    this.logger.log(`Uploaded: ${key}`);
    return key;
  }

  /**
   * Delete a file from S3.
   */
  async delete(key: string): Promise<void> {
    if (!key) return;

    try {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      this.logger.log(`Deleted: ${key}`);
    } catch (err) {
      this.logger.warn(`Failed to delete ${key}: ${err.message}`);
    }
  }

  /**
   * Delete multiple files from S3.
   */
  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  /**
   * Get a presigned download URL (expires in specified seconds).
   * Default expiry: 1 hour.
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3, command, { expiresIn });
    return url;
  }

  /**
   * Get the public URL for a file (if bucket is public or using CloudFront).
   */
  getPublicUrl(key: string): string {
    const region = this.config.get<string>('AWS_REGION');
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  /**
   * Generate the S3 folder path for a campaign's assets.
   */
  getCampaignPath(campaignSlug: string, assetType: string): string {
    return `campaigns/${campaignSlug}/${assetType}`;
  }
}
