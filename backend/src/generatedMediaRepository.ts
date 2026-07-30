import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedMedia } from "../../frontend/src/game/types.js";

const MEDIA_BUCKET = "match-media";

export class GeneratedMediaRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async upload(input: {
    accountId: string;
    accountName: string;
    matchNumber: number;
    title: string;
    sourceVideoId: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<GeneratedMedia> {
    const id = randomUUID();
    const extension = input.mimeType.includes("mp4") ? "mp4" : "webm";
    const storagePath = `match-${input.matchNumber}/${id}.${extension}`;
    const uploaded = await this.supabase.storage.from(MEDIA_BUCKET).upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });
    if (uploaded.error) throw uploaded.error;
    const publicUrl = this.supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data.publicUrl;
    const createdAt = Date.now();
    const media: GeneratedMedia = {
      id,
      accountId: input.accountId,
      accountName: input.accountName,
      matchNumber: input.matchNumber,
      title: input.title,
      sourceVideoId: input.sourceVideoId,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      publicUrl,
      createdAt,
    };
    const saved = await this.supabase.from("generated_media").insert({
      id,
      account_id: input.accountId,
      match_number: input.matchNumber,
      media,
      storage_path: storagePath,
      created_at: new Date(createdAt).toISOString(),
    });
    if (saved.error) {
      await this.supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
      throw saved.error;
    }
    return media;
  }

  async list(limit: number): Promise<GeneratedMedia[]> {
    const response = await this.supabase
      .from("generated_media")
      .select("media")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));
    if (response.error) throw response.error;
    return (response.data ?? []).map((row) => row.media as GeneratedMedia);
  }
}
