import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { z } from 'zod';
import { portableSchema } from '../packages/mcp-server/src/schema-portability.ts';
import { catalog } from '../packages/mcp-server/src/catalog.ts';

describe('published schema portability', () => {
  it('preserves tuple length/order, nullable constraints and strict object semantics', () => {
    const original = z.toJSONSchema(
      z.strictObject({
        face_order: z.tuple([
          z.literal('U'),
          z.literal('R'),
          z.literal('F'),
          z.literal('D'),
          z.literal('L'),
          z.literal('B'),
        ]),
        elapsed: z.number().min(0).nullable(),
        label: z.string().min(2).nullable(),
      }),
    );
    const normalized = portableSchema(original);
    const ajv = new Ajv2020({ strict: false });
    const before = ajv.compile(original),
      after = ajv.compile(normalized);
    const valid = { face_order: ['U', 'R', 'F', 'D', 'L', 'B'], elapsed: 0, label: 'ok' };
    const samples = [
      valid,
      { ...valid, elapsed: null, label: null },
      { ...valid, elapsed: -1 },
      { ...valid, label: 'x' },
      { ...valid, elapsed: '0' },
      { ...valid, face_order: valid.face_order.slice(0, 5) },
      { ...valid, face_order: [...valid.face_order, 'U'] },
      { ...valid, face_order: ['R', 'U', 'F', 'D', 'L', 'B'] },
      { ...valid, extra: true },
    ];
    expect(samples.map((value) => Boolean(after(value)))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    for (const value of samples) expect(after(value)).toBe(before(value));
    expect(normalized.additionalProperties).toBe(false);
    expect(
      portableSchema({ type: ['number', 'null'], anyOf: [{ minimum: 2 }, { const: null }] }),
    ).toEqual({
      anyOf: [{ minimum: 2 }, { const: null }],
      allOf: [{ anyOf: [{ type: 'number' }, { type: 'null' }] }],
    });
  });
  it('publishes no boolean items or array-valued type while preserving closed inputs', () => {
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'items') expect(child).not.toBe(false);
        if (key === 'type') expect(Array.isArray(child)).toBe(false);
        check(child);
      }
    };
    for (const tool of catalog) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      check(tool.inputSchema);
      check(tool.outputSchema);
    }
  });
});
