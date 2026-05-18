import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export const workspaceRoot = root;
export const publicDir = join(root, 'public');
export const port = Number(process.env.PORT || 5173);
