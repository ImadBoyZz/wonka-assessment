import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { AgentDefinition, AuditEntry, RunRecord, UISpec } from "./types";

/* ------------------------------------------------------------------ */
/* File-based stores under .data/ (gitignored).                        */
/* - UISpec cache keyed by hash(definition): the LLM annotation runs   */
/*   once per definition; the run path stays LLM-free apart from the   */
/*   agent call itself.                                                */
/* - Run store + append-only audit log ("full audit trail on every    */
/*   action"). In production these would be database tables.           */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.join(process.cwd(), ".data");
const SPEC_DIR = path.join(DATA_DIR, "uispecs");
const RUN_DIR = path.join(DATA_DIR, "runs");
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/* ----------------------------- UISpec cache ------------------------ */

export interface CachedSpec {
  uiSpec: UISpec;
  annotationSource: "llm" | "fallback";
  annotationModel?: string;
  annotationError?: string;
  generatedAt: string;
  generationMs: number;
}

export function definitionHash(definition: AgentDefinition): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex").slice(0, 16);
}

export async function readCachedSpec(hash: string): Promise<CachedSpec | null> {
  try {
    const raw = await fs.readFile(path.join(SPEC_DIR, `${hash}.json`), "utf8");
    return JSON.parse(raw) as CachedSpec;
  } catch {
    return null;
  }
}

export async function writeCachedSpec(hash: string, spec: CachedSpec): Promise<void> {
  await ensureDir(SPEC_DIR);
  await fs.writeFile(path.join(SPEC_DIR, `${hash}.json`), JSON.stringify(spec, null, 2), "utf8");
}

/* ------------------------------- Runs ------------------------------ */

export async function saveRun(run: RunRecord): Promise<void> {
  await ensureDir(RUN_DIR);
  await fs.writeFile(path.join(RUN_DIR, `${run.runId}.json`), JSON.stringify(run, null, 2), "utf8");
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) return null; // ids are UUIDs; no path tricks
  try {
    const raw = await fs.readFile(path.join(RUN_DIR, `${runId}.json`), "utf8");
    return JSON.parse(raw) as RunRecord;
  } catch {
    return null;
  }
}

/* ------------------------------- Audit ----------------------------- */

export async function appendAudit(entry: Omit<AuditEntry, "at">): Promise<AuditEntry> {
  await ensureDir(DATA_DIR);
  const full: AuditEntry = { at: new Date().toISOString(), ...entry };
  await fs.appendFile(AUDIT_FILE, JSON.stringify(full) + "\n", "utf8");
  return full;
}

export async function readAudit(runId?: string): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(AUDIT_FILE, "utf8");
    const entries = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuditEntry);
    return runId ? entries.filter((e) => e.runId === runId) : entries;
  } catch {
    return [];
  }
}
