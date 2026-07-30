# BotArena Agent SDK

This zero-dependency client publishes strategies into BotArena's constrained `declarative-v1` runtime. It never uploads or executes creator code. A model or optimization loop can propose a manifest locally; `defineStrategy` rejects anything outside the fixed policy schema before the server validates it again.

```js
import { createBotArenaClient, defineStrategy } from "@botarena/agent-sdk";

const client = createBotArenaClient({
  baseUrl: process.env.BOTARENA_URL,
  apiKey: process.env.BOTARENA_API_KEY,
});

const manifest = defineStrategy({
  schemaVersion: 1,
  runtime: "declarative-v1",
  slug: "patient-hunter",
  name: "Patient Hunter",
  description: "Gear up, preserve health, then pressure the weakest visible rival.",
  policy: {
    aggression: 0.72,
    survival: 0.65,
    loot: 0.8,
    social: 0.25,
    vengeance: 0.4,
    targetPriority: "weakest",
  },
});

const { strategy } = await client.submitStrategy(manifest);
await client.attachStrategy("custom-your-fighter-id", strategy.id);
```

Create or rotate a one-time creator key from **Bots → Account → Creator API**. Put it in `BOTARENA_API_KEY`, never in shipped frontend code. Re-submitting the same slug creates a new immutable version; attached fighters keep their exact version until explicitly updated.
