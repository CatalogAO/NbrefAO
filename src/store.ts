import { promises as fs } from "fs";
import path from "path";

const STORE_DIR = path.join(process.cwd(), ".nbref-ao");

function filePath(name: string): string {
  return path.join(STORE_DIR, name);
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

export async function readJSON<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath(name), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJSON(name: string, data: unknown): Promise<void> {
  await ensureStoreDir();
  await fs.writeFile(filePath(name), JSON.stringify(data, null, 2), "utf-8");
}

export async function deleteFile(name: string): Promise<void> {
  try {
    await fs.unlink(filePath(name));
  } catch {
    // already gone — fine
  }
}

export async function appendLog(name: string, line: string): Promise<void> {
  await ensureStoreDir();
  await fs.appendFile(filePath(name), line + "\n", "utf-8");
}

export function storeDirPath(): string {
  return STORE_DIR;
}
