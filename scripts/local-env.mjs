// Loads private test settings (e-mails, test passwords, demo names) from data/local.env.
// data/ is git-ignored, so none of this is ever published. Real environment variables win over the file.
import {readFileSync} from 'node:fs';
try {
  for (const line of readFileSync(new URL('../data/local.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
