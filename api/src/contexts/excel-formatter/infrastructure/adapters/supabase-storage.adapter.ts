import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { FileStoragePort } from '../../application/ports';

const BUCKET_NAME = 'templates';

@Injectable()
export class SupabaseStorageAdapter implements FileStoragePort {
  private readonly logger = new Logger(SupabaseStorageAdapter.name);
  private client: SupabaseClient | null = null;

  private getClient(): SupabaseClient {
    if (this.client) return this.client;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for file storage',
      );
    }

    this.client = createClient(supabaseUrl, supabaseKey);
    return this.client;
  }

  async uploadFile(
    buffer: Buffer,
    path: string,
    contentType: string,
  ): Promise<string> {
    const client = this.getClient();

    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .upload(path, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      this.logger.error(`Failed to upload file to ${path}: ${error.message}`);
      throw new Error(`File upload failed: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = client.storage
      .from(BUCKET_NAME)
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  }

  async downloadFile(path: string): Promise<Buffer> {
    const client = this.getClient();

    const { data, error } = await client.storage
      .from(BUCKET_NAME)
      .download(path);

    if (error) {
      this.logger.error(`Failed to download file from ${path}: ${error.message}`);
      throw new Error(`File download failed: ${error.message}`);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteFile(path: string): Promise<void> {
    const client = this.getClient();

    const { error } = await client.storage
      .from(BUCKET_NAME)
      .remove([path]);

    if (error) {
      this.logger.error(`Failed to delete file at ${path}: ${error.message}`);
      throw new Error(`File deletion failed: ${error.message}`);
    }
  }
}
