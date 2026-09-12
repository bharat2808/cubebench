import type { DurableObjectStorage, SqlStorage } from '@cloudflare/workers-types';
import type {
  Collection,
  IndexFields,
  Repository,
} from '../../packages/persistence/src/index.ts';

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

type Row = Record<string, string | number | null>;

export class DurableObjectRepository implements Repository {
  readonly sql: SqlStorage;

  constructor(readonly storage: DurableObjectStorage) {
    this.sql = storage.sql;
    this.migrate();
  }

  private migrate() {
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    if (this.sql.exec('SELECT version FROM migrations WHERE version=1').toArray().length) return;
    this.sql.exec(
      tables
        .map(
          (table) =>
            `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, body TEXT NOT NULL, match_id TEXT, participant_id TEXT, league TEXT, size INTEGER, classification TEXT, status TEXT, owner_id TEXT, seed TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE INDEX IF NOT EXISTS ${table}_match ON ${table}(match_id, status); CREATE INDEX IF NOT EXISTS ${table}_owner ON ${table}(owner_id, created_at); CREATE INDEX IF NOT EXISTS ${table}_leaderboard ON ${table}(league, classification, size, created_at);`,
        )
        .join(''),
    );
    this.sql.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS rounds_seed_unique ON rounds(seed); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, round_id TEXT, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_replay ON events(match_id,id); CREATE TRIGGER IF NOT EXISTS results_immutable_update BEFORE UPDATE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END; CREATE TRIGGER IF NOT EXISTS results_immutable_delete BEFORE DELETE ON results BEGIN SELECT RAISE(ABORT,'immutable result'); END; CREATE TRIGGER IF NOT EXISTS events_immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END; CREATE TRIGGER IF NOT EXISTS events_immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END; INSERT INTO migrations VALUES(1,?)`,
      new Date().toISOString(),
    );
  }

  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  get<T>(table: Collection, id: string): T | undefined {
    const row = this.sql.exec<Row>(`SELECT body FROM ${table} WHERE id=?`, id).toArray()[0];
    return row ? (JSON.parse(String(row.body)) as T) : undefined;
  }

  private write(table: Collection, id: string, body: unknown, index: IndexFields, insert: boolean) {
    const values = columns.map(
      (key) => index[key] ?? (key === 'created_at' ? new Date().toISOString() : null),
    );
    this.sql.exec(
      `INSERT INTO ${table}(id,body,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')}) ${insert ? '' : `ON CONFLICT(id) DO UPDATE SET body=excluded.body,${columns.map((key) => `${key}=excluded.${key}`).join(',')}`}`,
      id,
      JSON.stringify(body),
      ...values,
    );
  }

  put(table: Collection, id: string, body: unknown, index: IndexFields = {}) {
    this.write(table, id, body, index, false);
  }

  insert(table: Collection, id: string, body: unknown, index: IndexFields = {}) {
    this.write(table, id, body, index, true);
  }

  list<T>(table: Collection, filter: Partial<IndexFields> = {}, limit = 1000): T[] {
    const entries = Object.entries(filter).filter(([key]) =>
      (columns as readonly string[]).includes(key),
    );
    const where = entries.length
      ? ` WHERE ${entries.map(([key]) => `${key}=?`).join(' AND ')}`
      : '';
    return this.sql
      .exec<Row>(
        `SELECT body FROM ${table}${where} ORDER BY created_at DESC,id LIMIT ?`,
        ...entries.map(([, value]) => value),
        limit,
      )
      .toArray()
      .map((row) => JSON.parse(String(row.body)) as T);
  }

  appendEvent(matchId: string, roundId: string | null, body: (id: number) => unknown): unknown {
    const next = Number(
      this.sql.exec<{ seq: number | null }>('SELECT COALESCE(MAX(id),0) AS seq FROM events').one()
        .seq,
    );
    const event = body(next + 1);
    this.sql.exec(
      'INSERT INTO events(id,match_id,round_id,body) VALUES(?,?,?,?)',
      next + 1,
      matchId,
      roundId,
      JSON.stringify(event),
    );
    return event;
  }

  events(matchId: string, after = 0, limit = 1000): unknown[] {
    return this.sql
      .exec<Row>(
        'SELECT body FROM events WHERE match_id=? AND id>? ORDER BY id LIMIT ?',
        matchId,
        after,
        limit,
      )
      .toArray()
      .map((row) => JSON.parse(String(row.body)) as unknown);
  }

  lastEvent(matchId: string): unknown | undefined {
    const row = this.sql
      .exec<Row>('SELECT body FROM events WHERE match_id=? ORDER BY id DESC LIMIT 1', matchId)
      .toArray()[0];
    return row ? JSON.parse(String(row.body)) : undefined;
  }

  close() {}
}
