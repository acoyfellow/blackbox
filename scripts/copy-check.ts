import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');

const arrow = String.fromCharCode(0x2192);

const bannedPhrases = [
  "in today's rapidly evolving landscape",
  'in the realm of',
  'when it comes to',
  'at its core',
  "let's dive into",
  "it's worth noting",
  "it's important to note",
  'a testament to',
  'this is where',
  "whether you're",
  'in conclusion',
  'overall',
  'ultimately',
  'i hope this helps',
  'cut through the noise',
  'game-changer',
  'paradigm shift',
  'wake-up call',
  'seamless',
  'robust',
  'revolutionary',
  'cutting-edge',
  'leverage',
  'unlock',
  'supercharge',
  'effortless',
  'blazing',
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.(svelte|ts)$/.test(name) ? [path] : [];
  });
}

export function findHits(text: string): { line: number; match: string }[] {
  return text.split('\n').flatMap((content, index) => {
    const lower = content.toLowerCase();
    const matches = bannedPhrases.filter((phrase) => lower.includes(phrase));

    if (content.includes(arrow)) matches.push('U+2192 arrow');

    return matches.map((match) => ({ line: index + 1, match }));
  });
}

const files = [
  join(root, 'README.md'),
  join(root, 'index.html'),
  ...sourceFiles(join(root, 'src')),
];

const hits = files.flatMap((file) =>
  findHits(readFileSync(file, 'utf8')).map(
    (hit) => `${relative(root, file)}:${hit.line}: ${hit.match}`,
  ),
);

if (hits.length > 0) {
  console.error(hits.join('\n'));
  process.exit(1);
}

console.log(`copy-check: ${files.length} files clean`);
