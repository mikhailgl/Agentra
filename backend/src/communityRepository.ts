import type { SupabaseClient } from "@supabase/supabase-js";

export class CommunityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async countFighterFans(botId: string): Promise<number> {
    const response = await this.supabase
      .from("player_accounts")
      .select("id", { count: "exact", head: true })
      .contains("state->favoriteBotIds", [botId]);
    if (response.error) throw response.error;
    return response.count ?? 0;
  }
}
