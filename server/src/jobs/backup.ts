import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/db.js';

const KEEP = 30;

export async function backupNow(label = ''): Promise<string> {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `inventory-${stamp}${label ? '-' + label : ''}.db`;
  await db.backup(path.join(config.backupDir, name));
  prune();
  return name;
}

function prune() {
  const files = listBackups();
  for (const f of files.slice(KEEP)) fs.rmSync(path.join(config.backupDir, f.name), { force: true });
}

export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs
    .readdirSync(config.backupDir)
    .filter((f) => f.endsWith('.db'))
    .map((name) => {
      const st = fs.statSync(path.join(config.backupDir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}
