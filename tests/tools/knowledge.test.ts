import { describe, expect, it } from 'vitest';
import { ApiIndex } from '../../src/knowledge/ApiIndex.js';
import { build_get_symbol_result, build_search_api_result } from '../../src/tools/knowledge.js';

const source = `declare class SceneManager {
    _current: Scene;
    get current(): Scene;
    init(): void;
    dispose(): void;
}
declare const scene_manager: SceneManager;
export { scene_manager as SceneManager };
`;

const other = `export declare class CameraController {
    current_tilt: number;
    set_rotation(tilt?: number, orientation?: number): void;
}
`;

const index = new ApiIndex([
  { package: 'ohzi-core', path: 'SceneManager.d.ts', source },
  { package: 'ohzi-core', path: 'camera_controller/CameraController.d.ts', source: other }
]);

function text_of(result: { content: Array<{ type: string; text?: string }> }): string
{
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('search_api', () =>
{
  it('lists matching symbols with package and file', () =>
  {
    const text = text_of(build_search_api_result(index, { query: 'SceneManager' }));

    expect(text).toContain('SceneManager');
    expect(text).toContain('ohzi-core');
    expect(text).toContain('SceneManager.d.ts');
  });

  it('shows which members matched the query', () =>
  {
    const text = text_of(build_search_api_result(index, { query: 'set_rotation' }));

    expect(text).toContain('CameraController');
    expect(text).toContain('set_rotation');
  });

  it('marks a singleton so it is not mistaken for a constructible class', () =>
  {
    const text = text_of(build_search_api_result(index, { query: 'SceneManager' }));

    expect(text.toLowerCase()).toContain('singleton');
  });

  it('says plainly when nothing matched', () =>
  {
    const result = build_search_api_result(index, { query: 'zzz_nothing' });

    expect(text_of(result).toLowerCase()).toContain('no api symbols');
    expect(result.isError).toBeUndefined();
  });

  it('filters by package', () =>
  {
    expect(text_of(build_search_api_result(index, { query: 'current', package: 'pit-js' })).toLowerCase())
      .toContain('no api symbols');
  });
});

describe('get_symbol', () =>
{
  it('renders every member grouped by kind', () =>
  {
    const text = text_of(build_get_symbol_result(index, { name: 'SceneManager' }));

    expect(text).toContain('get current(): Scene');
    expect(text).toContain('init(): void');
    expect(text).toContain('dispose(): void');
  });

  it('names the source file so the reader can go deeper', () =>
  {
    expect(text_of(build_get_symbol_result(index, { name: 'CameraController' })))
      .toContain('camera_controller/CameraController.d.ts');
  });

  it('suggests near matches when the name is unknown', () =>
  {
    const result = build_get_symbol_result(index, { name: 'SceneManger' });

    expect(result.isError).toBe(true);
    expect(text_of(result)).toContain('SceneManager');
  });

  it('is case insensitive', () =>
  {
    expect(build_get_symbol_result(index, { name: 'scenemanager' }).isError).toBeUndefined();
  });
});
