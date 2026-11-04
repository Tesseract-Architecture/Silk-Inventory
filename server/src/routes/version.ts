// Qué versión corre y si hay una más nueva en GitHub (para avisar que falta actualizar).
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/auth.js';
import { config } from '../config.js';

interface Commit {
  sha: string;
  message: string;
  date: string;
}

interface VersionInfo {
  repo: string;
  current: { sha: string | null; builtAt: string | null };
  latest: Commit | null;
  /** Commits en GitHub que todavía no están corriendo. null = no se pudo saber. */
  pending: Commit[] | null;
  updateCommand: string;
  error?: string;
}

const UPDATE_COMMAND = 'bash ~/inventario/deploy/update.sh';
const CACHE_MS = 10 * 60_000;
let cache: { at: number; value: VersionInfo } | null = null;

const current = () => {
  const sha = process.env.GIT_COMMIT;
  return { sha: sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null, builtAt: process.env.BUILD_DATE || null };
};

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${config.githubRepo}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'inventario-silk' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
  return (await res.json()) as T;
}

type GhCommit = { sha: string; commit: { message: string; author: { date: string } } };
const toCommit = (c: GhCommit): Commit => ({
  sha: c.sha,
  message: c.commit.message.split('\n')[0],
  date: c.commit.author.date,
});

export async function versionInfo(force = false): Promise<VersionInfo> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const cur = current();
  const value: VersionInfo = { repo: config.githubRepo, current: cur, latest: null, pending: null, updateCommand: UPDATE_COMMAND };
  try {
    value.latest = toCommit(await gh<GhCommit>('/commits/main'));
    if (cur.sha) {
      if (value.latest.sha.startsWith(cur.sha) || cur.sha.startsWith(value.latest.sha)) value.pending = [];
      else {
        const cmp = await gh<{ status: string; commits: GhCommit[] }>(`/compare/${cur.sha}...${value.latest.sha}`);
        value.pending = cmp.commits.map(toCommit).reverse();
      }
    }
  } catch (e) {
    value.error = `No se pudo consultar GitHub: ${(e as Error).message}`;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function versionRoutes(app: FastifyInstance) {
  app.get('/api/admin/version', { preHandler: requireAdmin }, async (req) =>
    versionInfo((req.query as { refresh?: string }).refresh === '1'),
  );
}
