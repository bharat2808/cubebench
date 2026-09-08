import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Collection =
  | 'identities'
  | 'matches'
  | 'rounds'
  | 'participants'
  | 'runs'
  | 'results'
  | 'formats'
  | 'human_solves'
  | 'audit'
  | 'tokens';
export type Actor = { id: string; role: 'community' | 'runner' | 'admin'; clientIdentity?: string };
export type IndexFields = {
  match_id?: string;
  participant_id?: string;
  league?: string;
  size?: number;
  classification?: string;
  status?: string;
  owner_id?: string;
  seed?: string;
  created_at?: string;
};
export type StoredEvent = { id: number; match_id: string; round_id: string | null; body: string };
export interface Repository {
  transaction<T>(fn: () => T): T;
  get<T>(table: Collection, id: string): T | undefined;
  put(table: Collection, id: string, body: unknown, index?: IndexFields): void;
  insert(table: Collection, id: string, body: unknown, index?: IndexFields): void;
  list<T>(table: Collection, filter?: Partial<IndexFields>, limit?: number): T[];
  appendEvent(match_id: string, round_id: string | null, body: (id: number) => unknown): unknown;
  events(match_id: string, after?: number, limit?: number): unknown[];
  lastEvent(match_id: string): unknown | undefined;
  close(): void;
}
const tables: Collection[] = [
  'identities',
  'matches',
  'rounds',
  'participants',
  'runs',
  'results',
  'formats',
  'human_solves',
  'audit',
  'tokens',
];
const columns = [
  'match_id',
  'participant_id',
  'league',
  'size',
  'classification',
  'status',
  'owner_id',
  'seed',
  'created_at',
] as const;
export class SqliteRepository implements Repository {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }
  migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    if (this.db.prepare('SELECT version FROM migrations WHERE version=1').get()) return;
    this.db
      .transaction(() => {
        for (const table of tables) {
          this.db.exec(
            `CREATE TABLE ${table}(id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)), match_id TEXT, participant_id TEXT, league TEXT, size INTEGER, classification TEXT, status TEXT, owner_id TEXT, seed TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
          );
          this.db.exec(
            `CREATE INDEX ${table}_match ON ${table}(match_id, status); CREATE INDEX ${table}_owner ON ${table}(owner_id, created_at); CREATE INDEX ${table}_leaderboard ON ${table}(league, classification, size, created_at)`,
          );
        }
        this.db.exec(
          `CREATE UNIQUE INDEX rounds_seed_unique ON rounds(seed); CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, round_id TEXT, body TEXT NOT NULL CHECK(json_valid(body))); CREATE INDEX events_replay ON events(match_id,id); CREATE TRIGGER results_immutable_update BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END; CREATE TRIGGER results_immutable_delete BEFORE DELETE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END; CREATE TRIGGER events_immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END; CREATE TRIGGER events_immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;`,
        );
        this.db.prepare('INSERT INTO migrations VALUES(1,?)').run(new Date().toISOString());
      })
      .immediate();
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  get<T>(table: Collection, id: string): T | undefined {
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id) as
      { body: string } | undefined;
    return row ? (JSON.parse(row.body) as T) : undefined;
  }
  private write(table: Collection, id: string, body: unknown, index: IndexFields, insert: boolean) {
    const values = columns.map(
      (k) => index[k] ?? (k === 'created_at' ? new Date().toISOString() : null),
    );
    this.db
      .prepare(
        `INSERT INTO ${table}(id,body,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')}) ${insert ? '' : `ON CONFLICT(id) DO UPDATE SET body=excluded.body,${columns.map((k) => `${k}=excluded.${k}`).join(',')}`}`,
      )
      .run(id, JSON.stringify(body), ...values);
  }
  put(table: Collection, id: string, body: unknown, index: IndexFields = {}) {
    this.write(table, id, body, index, false);
  }
  insert(table: Collection, id: string, body: unknown, index: IndexFields = {}) {
    this.write(table, id, body, index, true);
  }
  list<T>(table: Collection, filter: Partial<IndexFields> = {}, limit = 1000): T[] {
    const entries = Object.entries(filter).filter(([k]) =>
      (columns as readonly string[]).includes(k),
    );
    return (
      this.db
        .prepare(
          `SELECT body FROM ${table}${entries.length ? ' WHERE ' + entries.map(([k]) => `${k}=?`).join(' AND ') : ''} ORDER BY created_at DESC,id LIMIT ?`,
        )
        .all(...entries.map(([, v]) => v), limit) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as T);
  }
  appendEvent(match_id: string, round_id: string | null, body: (id: number) => unknown): unknown {
    // The surrounding immediate transaction owns ID allocation and publication visibility.
    const next =
      (
        this.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='events'").get() as
          { seq: number } | undefined
      )?.seq ?? 0;
    const event = body(next + 1);
    this.db
      .prepare('INSERT INTO events(id,match_id,round_id,body) VALUES(?,?,?,?)')
      .run(next + 1, match_id, round_id, JSON.stringify(event));
    return event;
  }
  events(match_id: string, after = 0, limit = 1000): unknown[] {
    return (
      this.db
        .prepare('SELECT body FROM events WHERE match_id=? AND id>? ORDER BY id LIMIT ?')
        .all(match_id, after, limit) as { body: string }[]
    ).map((r) => JSON.parse(r.body) as unknown);
  }
  lastEvent(match_id: string): unknown | undefined {
    const row = this.db
      .prepare('SELECT body FROM events WHERE match_id=? ORDER BY id DESC LIMIT 1')
      .get(match_id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as unknown) : undefined;
  }
  close() {
    this.db.close();
  }
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export type Credential = {
  hash: string;
  actor: Actor;
  expires_at: string;
  purpose: 'access' | 'participant' | 'run';
  match_id?: string;
  participant_id?: string;
  round_id?: string;
  run_id?: string;
  used?: boolean;
};
export function issueAccessToken(
  store: Repository,
  name: string,
  role: Actor['role'] = 'community',
  ttlHours = 24,
) {
  const actor: Actor = { id: randomUUID(), role };
  const token = randomBytes(32).toString('base64url');
  const expires_at = new Date(Date.now() + ttlHours * 3600000).toISOString();
  store.transaction(() => {
    store.insert('identities', actor.id, { ...actor, name, created_at: new Date().toISOString() });
    store.insert(
      'tokens',
      hashToken(token),
      { hash: hashToken(token), actor, expires_at, purpose: 'access' } satisfies Credential,
      { owner_id: actor.id },
    );
    store.insert('audit', randomUUID(), {
      action: 'identity_provisioned',
      actor_id: actor.id,
      role,
    });
  });
  return { token, actor, expires_at };
}
export function authenticateToken(store: Repository, token: string): Actor | null {
  const record = store.get<Credential>('tokens', hashToken(token));
  return record?.purpose === 'access' && !record.used && Date.parse(record.expires_at) > Date.now()
    ? record.actor
    : null;
}
/** Operator-only CLI renewal: keep the identity stable across long trial schedules. */
export function renewAccessToken(store: Repository, identityId: string, ttlHours = 24) {
  const identity = store.get<Actor>('identities', identityId);
  if (!identity) throw new Error('Unknown identity');
  const actor: Actor = { id: identity.id, role: identity.role };
  const token = randomBytes(32).toString('base64url');
  const expires_at = new Date(Date.now() + ttlHours * 3600000).toISOString();
  store.transaction(() => {
    store.insert(
      'tokens',
      hashToken(token),
      { hash: hashToken(token), actor, expires_at, purpose: 'access' } satisfies Credential,
      { owner_id: actor.id },
    );
    store.insert('audit', randomUUID(), {
      action: 'credential_renewed',
      actor_id: actor.id,
      at: new Date().toISOString(),
    });
  });
  return { token, actor, expires_at };
}
