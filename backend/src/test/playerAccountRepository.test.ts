import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlayerAccountRepository } from "../playerAccountRepository.js";

test("settlement candidate lookup sends JSONB containment as serialized JSON", async () => {
  let containsColumn: string | undefined;
  let containsValue: unknown;
  const query = {
    select() {
      return this;
    },
    contains(column: string, value: unknown) {
      containsColumn = column;
      containsValue = value;
      return Promise.resolve({ data: [], error: null });
    },
  };
  const supabase = {
    from(table: string) {
      assert.equal(table, "player_accounts");
      return query;
    },
  } as unknown as SupabaseClient;

  const repository = new PlayerAccountRepository(supabase);
  await repository.listSettlementCandidates("match-42");

  assert.equal(containsColumn, "state->bets");
  assert.equal(containsValue, JSON.stringify([{ matchId: "match-42", status: "pending" }]));
});
