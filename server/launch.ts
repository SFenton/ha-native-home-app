import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';

const optionsSchema = z.object({
  auth_token: z.string().default(''),
  // Retired: live service calls belonged to the retired schema-1 workspace. The option stays in the schema so saved options still validate.
  enable_live_actions: z.boolean().default(false),
}).strict();
try {
  const options = optionsSchema.parse(JSON.parse(await readFile('/data/options.json', 'utf8')));
  if (options.auth_token) process.env.STUDIO_AUTH_TOKEN = options.auth_token;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid Home Assistant app options; startup refused');
}
await import('./index');
