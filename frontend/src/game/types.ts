export type BehaviorState = "seeking_loot" | "attacking" | "fleeing" | "wandering";

export type Personality = "Berserker" | "Coward" | "Scavenger" | "Hunter" | "Survivor";

export type Psychology = {
  aggression: number;
  loyalty: number;
  opportunism: number;
  selfPreservation: number;
  ambition: number;
  sociability: number;
  vengefulness: number;
  riskTolerance: number;
};

export type BaseStats = {
  strength: number;
  speed: number;
  perception: number;
  endurance: number;
};

export type BiomeType =
  | "forest"
  | "open_field"
  | "ruins"
  | "swamp"
  | "high_ground"
  | "industrial_yard"
  | "cave";

export type BiomeDefinition = {
  id: BiomeType;
  name: string;
  description: string;
  modifiers: {
    movementSpeed?: number;
    accuracy?: number;
    stealth?: number;
    visibility?: number;
    staminaDrain?: number;
    cover?: number;
    lootDensity?: number;
    ambushChance?: number;
  };
};

export type MapZone = BiomeDefinition & {
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
};

export type ArenaZoneConfig = {
  biome: BiomeType;
  x: number;
  y: number;
  radius?: number;
  width?: number;
  height?: number;
};

export type MatchConfig = {
  id: string;
  name: string;
  roster: {
    matchBotCount: number;
    persistentBotCount: number;
  };
  arena: {
    size: number;
    zoneBaseSize: number;
    spawnRadius: number;
    lootZoneRadius: number;
    edgePadding: number;
    zones: ArenaZoneConfig[];
  };
  loot: {
    initialCount: number;
    bonusInitialLoot: number;
    pickupRadius: number;
    sponsorDropRadius: number;
  };
  rules: {
    winnersRemaining: number;
    finalPhaseBotCount: number;
    maxVisibleEvents: number;
    maxDurationMs: number;
  };
  ai: {
    visibleEnemyRange: number;
    fleeEnemyRange: number;
    wanderTargetRadius: number;
    socialScanRange: number;
    allianceMinMs: number;
    allianceMaxMs: number;
  };
  events: {
    firstEventMinMs: number;
    eventCooldownMs: number;
    maxActiveArenaEvents: number;
    narrativeLimit: number;
    activeEventLimit: number;
    dangerDamagePerSecond: number;
    dangerZoneRadius: number;
    monsterPackSize: number;
    allowedArenaEvents: ArenaEventType[];
  };
};

export type BotAffinities = {
  biomes: Partial<Record<BiomeType, number>>;
  weapons: Record<string, number>;
  tools: Record<string, number>;
  combatRanges: {
    close: number;
    mid: number;
    long: number;
  };
};

export type CareerStats = {
  matchesPlayed: number;
  wins: number;
  kills: number;
  damageDealt: number;
  longestSurvivalTime: number;
};

export type AllianceData = {
  active: boolean;
  allyId: string;
  startedAt: number;
  expiresAt: number;
  reason: string;
};

export type Relationship = {
  trust: number;
  fear: number;
  respect: number;
  resentment: number;
  familiarity: number;
  alliance?: AllianceData;
};

export type AgentTargetPriority = "nearest" | "weakest" | "rival" | "bounty";

export type AgentPolicy = {
  aggression: number;
  survival: number;
  loot: number;
  social: number;
  vengeance: number;
  targetPriority: AgentTargetPriority;
};

export type AgentStrategy = {
  id: string;
  schemaVersion: 1;
  runtime: "declarative-v1";
  slug: string;
  name: string;
  description: string;
  version: number;
  authorName: string;
  policy: AgentPolicy;
  createdAt: number;
};

export type PersistentBot = {
  id: string;
  name: string;
  level: number;
  xp: number;
  baseStats: BaseStats;
  traits: string[];
  psychology: Psychology;
  career: CareerStats;
  relationships: Record<string, Relationship>;
  recentResults: string[];
  affinities: BotAffinities;
  custom?: boolean;
  ownerId?: string;
  ownerName?: string;
  tacticalInstruction?: string;
  doctrineSummary?: string;
  agentStrategy?: AgentStrategy;
  journal?: BotJournalEntry[];
};

export type BotJournalEntry = {
  id: string;
  timestamp: number;
  matchNumber?: number;
  title: string;
  body: string;
  tone: "origin" | "training" | "match" | "victory" | "setback" | "growth";
};

export type Weapon = {
  name: string;
  damage: number;
  range: number;
  cooldownMs: number;
  accuracy?: number;
  preferredBiomes?: BiomeType[];
};

export type EquipmentItem = {
  id: string;
  name: string;
  category: "armor" | "tool";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: {
    defense?: number;
    accuracy?: number;
    stealth?: number;
    speed?: number;
    trapPower?: number;
  };
};

export type Inventory = {
  weapon: Weapon | null;
  armor?: EquipmentItem | null;
  tool?: EquipmentItem | null;
};

export type BotThought = {
  id: number;
  timeMs: number;
  message: string;
  kind: BehaviorState | "combat" | "social" | "loot";
};

export type Bot = {
  id: string;
  name: string;
  x: number;
  y: number;
  health: number;
  alive: boolean;
  speed: number;
  personality: Personality;
  level: number;
  xp: number;
  baseStats: BaseStats;
  traits: string[];
  psychology: Psychology;
  career: CareerStats;
  relationships: Record<string, Relationship>;
  recentResults: string[];
  affinities: BotAffinities;
  custom?: boolean;
  ownerId?: string;
  ownerName?: string;
  tacticalInstruction?: string;
  doctrineSummary?: string;
  agentStrategy?: AgentStrategy;
  inventory: Inventory;
  behavior: BehaviorState;
  lastAttackAt: number;
  kills: number;
  damageDealt: number;
  survivalTimeMs: number;
  wanderTarget: Point | null;
  activeInfluences: ActiveInfluence[];
  currentBiome?: BiomeType;
  lastBiome?: BiomeType;
  biomeTimeMs: Partial<Record<BiomeType, number>>;
  weaponKills: Record<string, number>;
  thoughts: BotThought[];
  carriedCredits: number;
};

export type InfluenceType = "aggression" | "defense" | "revenge" | "reveal";

export type ActiveInfluence = {
  id: string;
  type: InfluenceType;
  expiresAtMs: number;
  source: "player";
  strength: number;
  targetBotId?: string;
};

export type WeaponLootItem = {
  id: string;
  x: number;
  y: number;
  type: "weapon";
  name: string;
  category: "weapon";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: {
    damage?: number;
    accuracy?: number;
    range?: number;
  };
  weapon: Weapon;
};

export type MedkitLootItem = {
  id: string;
  x: number;
  y: number;
  type: "medkit";
  name: string;
  category: "consumable";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: {
    healing?: number;
  };
  healAmount: number;
};

export type ArmorLootItem = {
  id: string;
  x: number;
  y: number;
  type: "armor";
  name: string;
  category: "armor";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: EquipmentItem["effects"];
  item: EquipmentItem;
};

export type ToolLootItem = {
  id: string;
  x: number;
  y: number;
  type: "tool";
  name: string;
  category: "tool";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: EquipmentItem["effects"];
  item: EquipmentItem;
};

export type CreditLootItem = {
  id: string;
  x: number;
  y: number;
  type: "credits";
  name: string;
  category: "credits";
  rarity: "common" | "uncommon" | "rare" | "legendary";
  preferredBiomes?: BiomeType[];
  effects: Record<string, never>;
  amount: number;
};

export type LootItem = WeaponLootItem | MedkitLootItem | ArmorLootItem | ToolLootItem | CreditLootItem;

export type Point = {
  x: number;
  y: number;
};

export type GameEvent = {
  id: number;
  timeMs: number;
  message: string;
  kind?: "damage" | "kill" | "alliance" | "betrayal" | "follow" | "avoid" | "trust" | "loot" | "sponsor" | "winner" | "system" | "player";
  botId?: string;
  targetId?: string;
  x?: number;
  y?: number;
  label?: string;
};

export type MatchEventType =
  | "kill"
  | "first_blood"
  | "kill_streak"
  | "low_hp"
  | "near_death_escape"
  | "weapon_pickup"
  | "sponsor_drop"
  | "arena_event"
  | "narrative"
  | "match_winner";

export type MatchEvent = {
  id: string;
  type: MatchEventType;
  timestamp: number;
  botId?: string;
  targetBotId?: string;
  message: string;
  importance: number;
  metadata?: Record<string, unknown>;
};

export type BetType = "winner" | "top3" | "mostKills" | "firstEliminated";

export type BetStatus = "pending" | "won" | "lost";

export type Bet = {
  id: string;
  matchId: string;
  type: BetType;
  botId: string;
  amount: number;
  odds: number;
  status: BetStatus;
  payout?: number;
};

export type Nudge = {
  id: string;
  matchId: string;
  type: InfluenceType;
  targetBotId: string;
  secondaryBotId?: string;
  timestamp: number;
  cost: number;
  success: boolean;
};

export type PlayerState = {
  accountId: string;
  accountName: string;
  credits: number;
  ownedBotIds: string[];
  favoriteBotIds: string[];
  draftedBotIds: string[];
  bets: Bet[];
  betHistory: Bet[];
  nudgeHistory: Nudge[];
  settledMatchIds: string[];
  fantasy: {
    seasonId: string | null;
    points: number;
    scoredMatchIds: string[];
    history: FantasyMatchScore[];
  };
  stats: {
    totalBetsPlaced: number;
    totalBetWinnings: number;
    totalSponsorshipsSent: number;
    totalNudgesUsed: number;
    biggestPayout: number;
  };
};

export type FantasyMatchScore = {
  matchId: string;
  scoredAt: number;
  points: number;
  fighterScores: Array<{
    botId: string;
    botName: string;
    points: number;
    placement: number;
    kills: number;
  }>;
};

export type FantasyLeaderboardEntry = {
  accountId: string;
  accountName: string;
  points: number;
  rosterSize: number;
};

export type BetResolution = {
  bet: Bet;
  botName: string;
  net: number;
};

export type MatchInfluenceResults = {
  matchId: string;
  startingCredits: number;
  endingCredits: number;
  betResults: BetResolution[];
  nudges: Nudge[];
};

export type ArenaState = {
  matchNumber: number;
  phase: "running" | "intermission" | "paused";
  activeBotIds: string[];
  lastWinnerId?: string;
  intermissionEndsAt?: number;
};

export type LeagueEventType = "league_match" | "headline" | "championship";

export type LeagueStanding = {
  botId: string;
  name: string;
  custom?: boolean;
  ownerName?: string;
  rating: number;
  division: "Bronze" | "Silver" | "Gold" | "Diamond";
  points: number;
  matchesPlayed: number;
  wins: number;
  podiums: number;
  kills: number;
  damageDealt: number;
  lastPlacement?: number;
  form: Array<"W" | "P" | "F">;
};

export type LeagueChampion = {
  seasonId: string;
  seasonNumber: number;
  seasonName: string;
  botId: string;
  botName: string;
  points: number;
  wins: number;
  crownedAt: number;
};

export type LeagueState = {
  version: 1;
  seasonId: string;
  seasonNumber: number;
  seasonName: string;
  status: "active" | "completed";
  startedAt: number;
  matchesPerSeason: number;
  matchesCompleted: number;
  currentEvent: {
    type: LeagueEventType;
    name: string;
    matchOfSeason: number;
  };
  standings: LeagueStanding[];
  champions: LeagueChampion[];
};

export type BasicMatchResult = {
  matchNumber: number;
  winnerBotId: string;
  winnerName: string;
  endedAt: number;
};

export type MatchLogEntrant = {
  botId: string;
  name: string;
  level: number;
  custom?: boolean;
  ownerName?: string;
  traits: string[];
};

export type MatchLogBotResult = {
  botId: string;
  name: string;
  alive: boolean;
  kills: number;
  damageDealt: number;
  survivalTimeMs: number;
  finalHealth: number;
  carriedCredits: number;
};

export type MatchLog = {
  version: 1;
  id: string;
  matchId: string;
  matchNumber: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  winnerBotId: string | null;
  winnerName: string | null;
  entrants: MatchLogEntrant[];
  botResults: MatchLogBotResult[];
  events: GameEvent[];
  highlights: MatchEvent[];
  narrativeMoments: NarrativeMoment[];
  arenaEvents: ArenaEvent[];
  competition?: {
    seasonId: string;
    seasonNumber: number;
    seasonName: string;
    eventType: LeagueEventType;
    eventName: string;
    matchOfSeason: number;
  };
};

export type GeneratedMedia = {
  id: string;
  accountId: string;
  accountName: string;
  matchNumber: number;
  title: string;
  sourceVideoId: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  createdAt: number;
};

export type FighterPublicProfile = {
  bot: PersistentBot;
  standing?: LeagueStanding;
  fanCount: number;
  recentStories: Array<{
    matchNumber: number;
    eventName: string;
    placement: number;
    kills: number;
    damageDealt: number;
    won: boolean;
    endedAt: number;
  }>;
};

export type MatchState = {
  id: string;
  config?: MatchConfig;
  entryFeeCredits: number;
  prizePoolCredits: number;
  bots: Bot[];
  loot: LootItem[];
  zones: MapZone[];
  mapEvents: MapEvent[];
  arenaEvents: ArenaEvent[];
  narrativeMoments: NarrativeMoment[];
  creatures: Creature[];
  learningEvents: string[];
  events: GameEvent[];
  logEvents: GameEvent[];
  matchEvents: MatchEvent[];
  historyEvents: GameEvent[];
  elapsedMs: number;
  ended: boolean;
  winnerId: string | null;
  nextEventId: number;
  eventDebounce: Record<string, number>;
  matchEventState: {
    firstBloodEmitted: boolean;
    lowHpBotIds: Record<string, true>;
    killStreaks: Record<string, number>;
    lastKillAtMs: number;
    lastArenaEventAtMs: number;
    firstArenaEventEmitted: boolean;
    suddenDeathStarted: boolean;
    eventCounts: Partial<Record<ArenaEventType, number>>;
    lastNarrativeByKey: Record<string, number>;
  };
  finalized: boolean;
};

export type ArenaEventType = "monster_spawn" | "rare_loot_drop" | "danger_zone" | "bounty_target" | "sudden_death";

export type ArenaEvent = {
  id: string;
  type: ArenaEventType;
  title: string;
  description: string;
  location?: { x: number; z: number };
  radius?: number;
  regionName?: string;
  startedAt: number;
  durationMs?: number;
  severity?: "minor" | "major" | "critical";
  affectedBotIds?: string[];
};

export type NarrativeMoment = {
  id: string;
  title: string;
  description?: string;
  severity: "info" | "danger" | "epic";
  createdAt: number;
  durationMs: number;
  relatedBotIds?: string[];
  location?: { x: number; z: number };
};

export type MapEvent = {
  id: string;
  type: "creature_attack" | "supply_drop" | "toxic_fog" | "fire" | "blackout" | "flood" | "bounty" | "loot_surge";
  biome?: BiomeType;
  startedAtMs: number;
  durationMs: number;
  effects: Record<string, number>;
  targetBotId?: string;
};

export type Creature = {
  id: string;
  name: string;
  health: number;
  damage: number;
  aggression: number;
  biome: BiomeType;
  x: number;
  y: number;
  targetBotId?: string;
  lastAttackAt: number;
  arenaEventId?: string;
  expiresAtMs?: number;
};

export type AgentKnowledgeSource = "witnessed" | "heard" | "inferred" | "action_result";

export type AgentMemory = {
  id: string;
  createdAtMs: number;
  source: AgentKnowledgeSource;
  summary: string;
  eventIds: number[];
  speakerId?: string;
};

export type AgentSpeech = {
  id: string;
  speakerId: string;
  message: string;
  targetIds?: string[];
  position: Point;
  createdAtMs: number;
  hearingRange: number;
};

export type HeardUtterance = {
  speechId: string;
  speakerId: string;
  speakerName: string;
  message: string;
  targetIds?: string[];
  heardAtMs: number;
  source: "heard";
};

export type ObservedPerson = {
  id: string;
  name: string;
  position: Point;
  distance: number;
  condition: "healthy" | "hurt" | "critical";
  visiblyArmed: boolean;
};

export type ObservedObject = {
  id: string;
  kind: "loot" | "creature";
  name: string;
  position: Point;
  distance: number;
  details: Record<string, string | number | boolean>;
};

export type ObservedEvent = {
  eventId: number;
  timeMs: number;
  message: string;
  source: "witnessed";
  actorId?: string;
  targetId?: string;
};

export type AvailableAction = {
  type: AgentAction["type"];
  targetIds?: string[];
  objectIds?: string[];
};

export type AgentObservation = {
  id: string;
  matchId: string;
  createdAtMs: number;
  self: {
    id: string;
    name: string;
    health: number;
    position: Point;
    inventory: Inventory;
  };
  knownRule: "Only one living participant can leave";
  location: {
    biome: BiomeType;
    biomeName: string;
  };
  visiblePeople: ObservedPerson[];
  visibleObjects: ObservedObject[];
  heardSpeech: HeardUtterance[];
  observedEvents: ObservedEvent[];
  relevantMemories: AgentMemory[];
  availableActions: AvailableAction[];
};

export type AgentAction =
  | { type: "move"; destination: Point }
  | { type: "speak"; message: string; targetIds?: string[] }
  | { type: "inspect"; objectId: string }
  | { type: "take"; objectId: string }
  | { type: "use"; objectId: string; targetId?: string }
  | { type: "attack"; targetId: string; weaponId?: string }
  | { type: "wait" };

export type AgentActionResult = {
  status: "in_progress" | "completed" | "rejected";
  actionType: AgentAction["type"];
  message: string;
  completedAtMs?: number;
  eventIds: number[];
};

export type AgentDecisionTrace = {
  id: string;
  matchId: string;
  agentId: string;
  observationId: string;
  operationId: string;
  proposedAction: AgentAction;
  result: AgentActionResult;
  recordedAtMs: number;
};
