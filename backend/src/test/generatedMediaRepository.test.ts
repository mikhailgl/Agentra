import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedMedia } from "../../../frontend/src/game/types.js";
import { GeneratedMediaRepository } from "../generatedMediaRepository.js";

test("generated videos are uploaded and returned through the public archive", async () => {
  let storedPath = "";
  let insertedMedia: GeneratedMedia | null = null;
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          assert.equal(bucket, "match-media");
          storedPath = path;
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://media.example/${path}` } }),
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => {
      assert.equal(table, "generated_media");
      return {
        insert: async (row: { media: GeneratedMedia }) => {
          insertedMedia = row.media;
          return { error: null };
        },
        select: () => ({
          order: () => ({
            limit: async () => ({ data: insertedMedia ? [{ media: insertedMedia }] : [], error: null }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;

  const repository = new GeneratedMediaRepository(client);
  const uploaded = await repository.upload({
    accountId: "account-1",
    accountName: "Circuit Sage",
    matchNumber: 48,
    title: "Ada's final stand",
    sourceVideoId: "match-48-short",
    mimeType: "video/webm",
    bytes: Buffer.from("video"),
  });

  assert.match(storedPath, /^match-48\/.+\.webm$/);
  assert.equal(uploaded.publicUrl, `https://media.example/${storedPath}`);
  assert.equal(uploaded.sizeBytes, 5);
  assert.deepEqual(await repository.list(10), [uploaded]);
});
