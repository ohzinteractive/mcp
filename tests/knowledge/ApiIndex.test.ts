import { describe, expect, it } from 'vitest';
import { ApiIndex } from '../../src/knowledge/ApiIndex.js';

// Copied verbatim from core/types/SceneManager.d.ts.
const scene_manager = `import type { Scene } from "three";
declare class SceneManager {
    _current: Scene;

    get current(): Scene;
    set current(arg: Scene);

    init(): void;
    add_scene(name: string): void;
    dispose(): void;
}

declare const scene_manager: SceneManager;
export { scene_manager as SceneManager };
`;

const camera_controller = `import type { Camera } from 'three';
export declare class CameraController {
    camera: Camera;
    current_tilt: number;
    constructor(input: Input);
    set_rotation(tilt?: number, orientation?: number, azimuth?: number): void;
    focus_on_bounding_box(bb: Box3, scale?: number): void;
    get_current_tilt(): number;
}
`;

const with_literal = `export declare class Thing {
    config: { width: number; height: number };
    resize(size: { x: number; y: number }): void;
}
`;

// Copied verbatim from core/types/scenes/AbstractScene.d.ts: no `declare`
// keyword, and members whose types span several lines.
const abstract_scene = `import { Scene } from "three";
export class AbstractScene extends Scene {
    constructor({ name, compilators }: {
        name: any;
        compilators: any;
    });
    name: any;
    is_loaded: boolean;
    loading_states: {
        regular: RegularLoadingState;
        high: HighQualityLoadingState;
    };
    get loading_progress(): number;
    on_assets_ready(): void;
    set_assets(objects: any, textures: any, sounds: any): void;
}
`;

function index()
{
  return new ApiIndex([
    { package: 'ohzi-core', path: 'SceneManager.d.ts', source: scene_manager },
    { package: 'ohzi-core', path: 'camera_controller/CameraController.d.ts', source: camera_controller },
    { package: 'ohzi-core', path: 'Thing.d.ts', source: with_literal },
    { package: 'ohzi-core', path: 'scenes/AbstractScene.d.ts', source: abstract_scene }
  ]);
}

describe('ApiIndex parsing', () =>
{
  it('resolves a singleton re-export to its public name', () =>
  {
    const symbol = index().get('SceneManager');

    expect(symbol?.kind).toBe('singleton');
    expect(symbol?.class_name).toBe('SceneManager');
  });

  it('parses an exported class', () =>
  {
    const symbol = index().get('CameraController');

    expect(symbol?.kind).toBe('class');
    expect(symbol?.package).toBe('ohzi-core');
    expect(symbol?.file).toBe('camera_controller/CameraController.d.ts');
  });

  it('captures methods with their full signature', () =>
  {
    const symbol = index().get('CameraController');
    const method = symbol?.members.find((m) => m.name === 'set_rotation');

    expect(method?.kind).toBe('method');
    expect(method?.signature).toBe('set_rotation(tilt?: number, orientation?: number, azimuth?: number): void');
  });

  it('captures properties', () =>
  {
    const member = index().get('CameraController')?.members.find((m) => m.name === 'current_tilt');

    expect(member?.kind).toBe('property');
    expect(member?.signature).toBe('current_tilt: number');
  });

  it('captures getters and setters separately', () =>
  {
    const members = index().get('SceneManager')?.members ?? [];

    expect(members.find((m) => m.name === 'current' && m.kind === 'getter')?.signature).toBe('get current(): Scene');
    expect(members.find((m) => m.name === 'current' && m.kind === 'setter')).toBeDefined();
  });

  it('captures the constructor', () =>
  {
    const member = index().get('CameraController')?.members.find((m) => m.name === 'constructor');

    expect(member?.signature).toBe('constructor(input: Input)');
  });

  it('does not mistake an inline type literal for the end of the class', () =>
  {
    const symbol = index().get('Thing');

    expect(symbol?.members.map((m) => m.name)).toEqual(['config', 'resize']);
    expect(symbol?.members[0].signature).toBe('config: { width: number; height: number }');
  });

  it('ignores import lines', () =>
  {
    expect(index().get('Camera')).toBeNull();
    expect(index().get('Scene')).toBeNull();
  });
});

describe('ApiIndex real-world declaration shapes', () =>
{
  it('indexes a class declared without the declare keyword', () =>
  {
    expect(index().get('AbstractScene')?.kind).toBe('class');
  });

  it('reads members that span several lines as one member', () =>
  {
    const members = index().get('AbstractScene')?.members ?? [];
    const names = members.map((m) => m.name);

    expect(names).toContain('loading_states');
    expect(names).toContain('on_assets_ready');
    expect(names).toContain('set_assets');
    // The inner lines of the type literal must not become members.
    expect(names).not.toContain('regular');
    expect(names).not.toContain('high');
  });

  it('does not treat a multi-line constructor parameter as members', () =>
  {
    const names = index().get('AbstractScene')?.members.map((m) => m.name) ?? [];

    expect(names).toContain('constructor');
    expect(names.filter((n) => n === 'name')).toHaveLength(1);
  });
});

describe('ApiIndex search', () =>
{
  it('finds a symbol by name, case insensitively', () =>
  {
    const hits = index().search('cameracontroller', undefined, 10);

    expect(hits[0].name).toBe('CameraController');
  });

  it('finds symbols by member name', () =>
  {
    const hits = index().search('focus_on_bounding_box', undefined, 10);

    expect(hits.map((h) => h.name)).toContain('CameraController');
    expect(hits[0].matched_members).toContain('focus_on_bounding_box');
  });

  it('filters by package', () =>
  {
    expect(index().search('current', 'pit-js', 10)).toHaveLength(0);
    expect(index().search('current', 'ohzi-core', 10).length).toBeGreaterThan(0);
  });

  it('respects the result limit', () =>
  {
    expect(index().search('c', undefined, 1)).toHaveLength(1);
  });

  it('returns nothing for a query that matches nothing', () =>
  {
    expect(index().search('definitely_not_here', undefined, 10)).toHaveLength(0);
  });

  it('reports how many symbols it indexed', () =>
  {
    expect(index().size).toBe(4);
  });
});
