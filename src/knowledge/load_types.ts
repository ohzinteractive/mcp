import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { SourceFile } from './ApiIndex.js';

// Where each package keeps its committed declarations, relative to the project
// root. Reading the CONSUMING project's types rather than anything bundled with
// this server is what keeps reported signatures locked to the versions that
// project actually pins.
export const TYPE_ROOTS: Array<{ package: string; dir: string }> = [
  { package: 'ohzi-core', dir: 'core/types' },
  { package: 'ohzi-components', dir: 'components/types' },
  { package: 'pit-js', dir: 'pit/types' }
];

function walk(dir: string, out: string[]): void
{
  let entries: string[];

  try
  {
    entries = readdirSync(dir);
  }
  catch
  {
    return;
  }

  for (const entry of entries)
  {
    const full = join(dir, entry);

    let is_dir = false;

    try
    {
      is_dir = statSync(full).isDirectory();
    }
    catch
    {
      continue;
    }

    if (is_dir)
    {
      walk(full, out);
      continue;
    }

    if (entry.endsWith('.d.ts'))
    {
      out.push(full);
    }
  }
}

export function load_types(root: string): SourceFile[]
{
  const files: SourceFile[] = [];

  for (const entry of TYPE_ROOTS)
  {
    const base = resolve(root, entry.dir);
    const found: string[] = [];

    walk(base, found);

    for (const path of found)
    {
      try
      {
        files.push({
          package: entry.package,
          path: relative(base, path).split('\\').join('/'),
          source: readFileSync(path, 'utf8')
        });
      }
      catch
      {
        // A file that cannot be read is skipped rather than failing the index.
        continue;
      }
    }
  }

  return files;
}
