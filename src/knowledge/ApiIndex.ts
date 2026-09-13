export interface SourceFile
{
  package: string;
  path: string;
  source: string;
}

export type MemberKind = 'property' | 'method' | 'getter' | 'setter' | 'constructor';

export interface ApiMember
{
  name: string;
  kind: MemberKind;
  signature: string;
}

export interface ApiSymbol
{
  name: string;
  class_name: string;
  kind: 'class' | 'singleton';
  package: string;
  file: string;
  members: ApiMember[];
}

export interface SearchHit extends ApiSymbol
{
  matched_members: string[];
}

// `declare` is optional: generated declarations use both `export declare class`
// and plain `export class` depending on how the class was authored.
const CLASS_PATTERN = /^(?:export\s+)?(?:declare\s+)?class\s+([A-Za-z0-9_]+)/;
const ALIAS_PATTERN = /^export\s*\{\s*([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)\s*\}/;
const GETTER_PATTERN = /^get\s+([A-Za-z0-9_]+)\s*\(/;
const SETTER_PATTERN = /^set\s+([A-Za-z0-9_]+)\s*\(/;
const CALLABLE_PATTERN = /^([A-Za-z0-9_$]+)\s*(?:<[^(]*>)?\s*\(/;
const PROPERTY_PATTERN = /^(?:readonly\s+)?([A-Za-z0-9_$]+)\s*\??\s*:/;

// Parses the .d.ts files a project has committed, so the reported signatures
// are the ones that project pins rather than whatever is newest. Deliberately
// not the TypeScript compiler API: that is a 20MB dependency for a published
// package, and .d.ts output is regular enough to scan reliably when the scan
// is tested against real fixtures.
class ApiIndex
{
  private symbols: Map<string, ApiSymbol>;

  constructor(files: SourceFile[])
  {
    this.symbols = new Map<string, ApiSymbol>();

    for (const file of files)
    {
      this.read(file);
    }
  }

  get size(): number
  {
    return this.symbols.size;
  }

  get(name: string): ApiSymbol | null
  {
    const found = this.symbols.get(name.toLowerCase());

    return found === undefined ? null : found;
  }

  search(query: string, pkg: string | undefined, limit: number): SearchHit[]
  {
    const wanted = query.toLowerCase();
    const hits: SearchHit[] = [];

    for (const symbol of this.symbols.values())
    {
      if (pkg !== undefined && symbol.package !== pkg)
      {
        continue;
      }

      const name_match = symbol.name.toLowerCase().includes(wanted);
      const matched_members = symbol.members
        .filter((member) => member.name.toLowerCase().includes(wanted))
        .map((member) => member.name);

      if (!name_match && matched_members.length === 0)
      {
        continue;
      }

      hits.push({ ...symbol, matched_members });
    }

    // Whole-name matches first, then by how much of the symbol matched.
    hits.sort((a, b) =>
    {
      const a_exact = a.name.toLowerCase() === wanted ? 0 : 1;
      const b_exact = b.name.toLowerCase() === wanted ? 0 : 1;

      if (a_exact !== b_exact)
      {
        return a_exact - b_exact;
      }

      return b.matched_members.length - a.matched_members.length;
    });

    return hits.slice(0, limit);
  }

  private read(file: SourceFile): void
  {
    const lines = file.source.split('\n');
    let current: ApiSymbol | null = null;

    // Members can span lines when their type is an inline literal, so lines are
    // accumulated until their braces balance and only then parsed. Without this
    // the inner lines of `loading_states: { regular: X; high: Y }` would each
    // be read as a separate member.
    let buffer = '';
    let balance = 0;

    for (const raw of lines)
    {
      const line = raw.trim();

      if (current === null)
      {
        const declared = CLASS_PATTERN.exec(line);

        if (declared !== null)
        {
          current = {
            name: declared[1],
            class_name: declared[1],
            kind: 'class',
            package: file.package,
            file: file.path,
            members: []
          };

          buffer = '';
          balance = 0;

          continue;
        }

        const alias = ALIAS_PATTERN.exec(line);

        if (alias !== null)
        {
          this.alias(alias[1], alias[2]);
        }

        continue;
      }

      if (buffer.length === 0)
      {
        if (line.length === 0)
        {
          continue;
        }

        // A lone closing brace at body level ends the class.
        if (line === '}' || line === '};')
        {
          this.store(current);
          current = null;

          continue;
        }
      }

      buffer = buffer.length === 0 ? line : `${buffer} ${line}`;
      balance += this.delta(line);

      if (balance <= 0)
      {
        const member = this.member(buffer);

        if (member !== null)
        {
          current.members.push(member);
        }

        buffer = '';
        balance = 0;
      }
    }

    if (current !== null)
    {
      this.store(current);
    }
  }

  // Tracks braces so an inline type literal such as `{ x: number }` is not
  // mistaken for the end of the class body.
  private delta(line: string): number
  {
    let delta = 0;

    for (const character of line)
    {
      if (character === '{')
      {
        delta++;
      }

      if (character === '}')
      {
        delta--;
      }
    }

    return delta;
  }

  private member(line: string): ApiMember | null
  {
    if (line.length === 0 || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*'))
    {
      return null;
    }

    const signature = line.replace(/;+\s*$/, '').trim();

    if (signature.length === 0)
    {
      return null;
    }

    const getter = GETTER_PATTERN.exec(signature);

    if (getter !== null)
    {
      return { name: getter[1], kind: 'getter', signature };
    }

    const setter = SETTER_PATTERN.exec(signature);

    if (setter !== null)
    {
      return { name: setter[1], kind: 'setter', signature };
    }

    const callable = CALLABLE_PATTERN.exec(signature);

    if (callable !== null)
    {
      const name = callable[1];

      return { name, kind: name === 'constructor' ? 'constructor' : 'method', signature };
    }

    const property = PROPERTY_PATTERN.exec(signature);

    if (property !== null)
    {
      return { name: property[1], kind: 'property', signature };
    }

    return null;
  }

  private store(symbol: ApiSymbol): void
  {
    this.symbols.set(symbol.name.toLowerCase(), symbol);
  }

  // `declare const scene_manager: SceneManager; export { scene_manager as
  // SceneManager }` publishes a singleton instance, not the class. Re-key it
  // under the name consumers actually import.
  private alias(local: string, exported: string): void
  {
    const source = this.symbols.get(local.toLowerCase());

    if (source !== undefined && source.name !== exported)
    {
      this.symbols.delete(local.toLowerCase());
      this.symbols.set(exported.toLowerCase(), { ...source, name: exported, kind: 'singleton' });

      return;
    }

    const by_class = [...this.symbols.values()].find((symbol) => symbol.class_name === exported);

    if (by_class !== undefined)
    {
      this.symbols.set(exported.toLowerCase(), { ...by_class, name: exported, kind: 'singleton' });
    }
  }
}

export { ApiIndex };
