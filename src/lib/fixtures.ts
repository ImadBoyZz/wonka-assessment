import { promises as fs } from "fs";
import path from "path";
import { FixtureSchema, type Fixture } from "./types";

/* Agent definitions are plain JSON files in /fixtures. Adding a new file there
 * is the whole "add an agent" workflow; no code changes. */

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

export async function listFixtures(): Promise<Fixture[]> {
  let files: string[];
  try {
    files = await fs.readdir(FIXTURES_DIR);
  } catch {
    return [];
  }

  const fixtures: Fixture[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const raw = await fs.readFile(path.join(FIXTURES_DIR, file), "utf8");
      const parsed = FixtureSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        fixtures.push(parsed.data);
      } else {
        console.warn(`[fixtures] Skipping ${file}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
      }
    } catch (err) {
      console.warn(`[fixtures] Skipping ${file}: ${err instanceof Error ? err.message : "unreadable"}`);
    }
  }
  return fixtures;
}

export async function getFixture(id: string): Promise<Fixture | null> {
  const fixtures = await listFixtures();
  return fixtures.find((f) => f.id === id) ?? null;
}
