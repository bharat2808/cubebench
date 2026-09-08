import { mkdirSync, writeFileSync } from 'node:fs';
import { catalog } from '../packages/mcp-server/src/catalog.ts';
mkdirSync('docs/schemas', { recursive: true });
for (const tool of catalog) {
  writeFileSync(
    `docs/schemas/${tool.name}.input.json`,
    JSON.stringify(tool.inputSchema, null, 2) + '\n',
  );
  writeFileSync(
    `docs/schemas/${tool.name}.output.json`,
    JSON.stringify(tool.outputSchema, null, 2) + '\n',
  );
}
