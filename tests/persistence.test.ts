import { describe, it, expect } from 'vitest';
import {
  SqliteRepository,
  issueAccessToken,
  authenticateToken,
  hashToken,
} from '../packages/persistence/src/index.js';
import { canonicalJson } from '../packages/benchmark-core/src/signatures.js';
describe('transactional persistence', () => {
  it('rolls back state and outbox together and maintains immutable events/results', () => {
    const db = new SqliteRepository(':memory:');
    expect(() =>
      db.transaction(() => {
        db.insert('matches', 'one', { status: 'active' });
        db.appendEvent('one', null, (id) => ({ id }));
        throw new Error('abort');
      }),
    ).toThrow('abort');
    expect(db.get('matches', 'one')).toBeUndefined();
    expect(db.events('one')).toEqual([]);
    db.transaction(() => {
      db.insert('results', 'one', { result: 'signed' });
      db.appendEvent('one', null, (id) => ({ id }));
    });
    expect(() => db.put('results', 'one', { tampered: true })).toThrow('immutable result');
    expect(() => db.db.prepare('UPDATE events SET body=?').run('{}')).toThrow('immutable event');
    expect(db.lastEvent('one')).toEqual({ id: 1 });
    db.close();
  });
  it('stores only token hashes with expiry and immutable role association', () => {
    const db = new SqliteRepository(':memory:');
    const issued = issueAccessToken(db, 'Test runner', 'runner');
    expect(authenticateToken(db, issued.token)).toEqual(issued.actor);
    expect(authenticateToken(db, 'bad-token')).toBeNull();
    expect(JSON.stringify(db.list('tokens'))).not.toContain(issued.token);
    const expired = issueAccessToken(db, 'Expired', 'community', -1);
    expect(authenticateToken(db, expired.token)).toBeNull();
    expect(db.get('tokens', hashToken(issued.token))).toBeTruthy();
    db.close();
  });
  it('enforces globally unique round seeds', () => {
    const db = new SqliteRepository(':memory:');
    db.insert('rounds', 'a', {}, { seed: 'seed' });
    expect(() => db.insert('rounds', 'b', {}, { seed: 'seed' })).toThrow();
    db.close();
  });
  it('canonical signatures do not depend on object insertion order', () => {
    expect(canonicalJson({ z: 1, a: { b: 2, a: 1 } })).toBe(
      canonicalJson({ a: { a: 1, b: 2 }, z: 1 }),
    );
  });
});

it('renews an existing identity without changing its role or result identity', async () => {
  const { renewAccessToken } = await import('../packages/persistence/src/index.js');
  const db = new SqliteRepository(':memory:');
  const first = issueAccessToken(db, 'Long trial runner', 'runner', -1);
  const renewed = renewAccessToken(db, first.actor.id);
  expect(renewed.actor).toEqual(first.actor);
  expect(authenticateToken(db, renewed.token)).toEqual(first.actor);
  expect(authenticateToken(db, first.token)).toBeNull();
  expect(renewed.token).not.toBe(first.token);
  expect(() => renewAccessToken(db, 'missing')).toThrow('Unknown identity');
  db.close();
});
