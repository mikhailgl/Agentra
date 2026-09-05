import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  checkpointSchema,
  type SurvivalCheckpoint,
  type SurvivalStore,
} from "./repository.js";

// Explicit local development storage. Production uses SurvivalRepository.
export class LocalSurvivalRepository implements SurvivalStore {
  constructor(private readonly path: string) {}
  async load(): Promise<SurvivalCheckpoint | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return checkpointSchema.parse(JSON.parse(raw));
  }
  async save(checkpoint: SurvivalCheckpoint) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(`${this.path}.tmp`, JSON.stringify(checkpoint), {
      mode: 0o600,
    });
    await rename(`${this.path}.tmp`, this.path);
  }
}
