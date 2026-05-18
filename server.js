import { fileURLToPath } from 'node:url';
import { startServer, testing } from './src/server/app.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();

export { testing };
