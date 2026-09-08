/**
 * Keep JSON Schema 2020-12 semantics while avoiding two Inspector portability
 * diagnostics: boolean `items` and array-valued `type`. This operates only on
 * schema positions, never examples/defaults/const values or property-name maps.
 */
export function portableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...schema };
  const child = (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? portableSchema(value as Record<string, unknown>)
      : value;
  for (const key of [
    '$defs',
    'definitions',
    'properties',
    'patternProperties',
    'dependentSchemas',
  ]) {
    const map = output[key];
    if (map && typeof map === 'object' && !Array.isArray(map))
      output[key] = Object.fromEntries(
        Object.entries(map).map(([name, value]) => [name, child(value)]),
      );
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    if (Array.isArray(output[key])) output[key] = output[key].map(child);
  }
  for (const key of [
    'items',
    'contains',
    'not',
    'if',
    'then',
    'else',
    'additionalProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
    'propertyNames',
  ]) {
    output[key] = key in output ? child(output[key]) : undefined;
    if (output[key] === undefined) delete output[key];
  }
  // `not: {}` rejects every instance exactly as the false schema does. In
  // particular this preserves the fixed tuple's ban on trailing items.
  if (output.items === false) output.items = { not: {} };
  if (Array.isArray(output.type)) {
    const union = { anyOf: output.type.map((type) => ({ type })) };
    delete output.type;
    if (!('anyOf' in output)) output.anyOf = union.anyOf;
    else output.allOf = [...(Array.isArray(output.allOf) ? output.allOf : []), union];
  }
  return output;
}
