// Copia il frontend statico da src/ a www/ (nessun bundler: meno dipendenze, meno rotture).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src'), out = join(root, 'www');
if (!existsSync(join(src, 'index.html'))) { console.error('src/index.html mancante'); process.exit(1); }
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
console.log('Frontend copiato in www/');
