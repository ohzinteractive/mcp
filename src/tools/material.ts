import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BridgeHost } from '../bridge/BridgeHost.js';
import type { ImageBlock, TextBlock, ToolHost, ToolResult } from './shared.js';
import { attach_capture, describe_error, failure, not_connected, text_or as text } from './shared.js';

const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

// A model root can hold dozens of materials. Listing them all would cost more
// context than it is worth, so only the first few are shown in detail.
const MAX_LISTED = 8;

function render_material(material: Record<string, unknown>): string[]
{
  const name = text(material.name, '');
  const lines = [`${name.length > 0 ? name : '(unnamed)'} (${text(material.type, 'Material')}) ${text(material.uuid, '')}`];

  const users = typeof material.users === 'number' ? material.users : 1;

  if (users > 1)
  {
    lines.push(`  shared by ${users} meshes in this scene: they all show this change`);
  }

  if (typeof material.color === 'string')
  {
    lines.push(`  color     ${material.color}`);
  }

  if (typeof material.roughness === 'number')
  {
    lines.push(`  roughness ${material.roughness}`);
  }

  if (typeof material.metalness === 'number')
  {
    lines.push(`  metalness ${material.metalness}`);
  }

  if (typeof material.emissive === 'string')
  {
    const intensity = typeof material.emissive_intensity === 'number' ? ` x ${material.emissive_intensity}` : '';
    lines.push(`  emissive  ${material.emissive}${intensity}`);
  }

  lines.push(`  opacity   ${typeof material.opacity === 'number' ? material.opacity : 1}${material.transparent === true ? ' (transparent)' : ''}`);

  if (typeof material.wireframe === 'boolean')
  {
    lines.push(`  wireframe ${material.wireframe ? 'yes' : 'no'}`);
  }

  return lines;
}

// asked is false for a read: a call with only a selector changes nothing on
// purpose, so it gets no change line.
function render_edit(edit: Record<string, unknown>, materials: Array<Record<string, unknown>>, asked: boolean): string
{
  const count = materials.length;
  const meshes = typeof edit.meshes === 'number' ? edit.meshes : count;
  const lines = [`${text(edit.target, '?')}: ${count} ${count === 1 ? 'material' : 'materials'} on ${meshes} ${meshes === 1 ? 'mesh' : 'meshes'}`];

  for (const material of materials.slice(0, MAX_LISTED))
  {
    lines.push(...render_material(material));
  }

  if (count > MAX_LISTED)
  {
    lines.push(`... ${count - MAX_LISTED} more materials not listed`);
  }

  const notes = Array.isArray(edit.notes) ? edit.notes.map((n) => String(n)) : [];

  for (const note of notes)
  {
    lines.push(`! ${note}`);
  }

  const changed = Array.isArray(edit.changed) ? edit.changed.map((c) => String(c)) : [];

  if (asked)
  {
    lines.push('');
    lines.push(changed.length === 0
      ? 'nothing changed: the values were invalid, or these materials do not have those fields.'
      : `changed: ${changed.join(', ')}`);
  }

  return lines.join('\n');
}

export interface SetMaterialArgs
{
  uuid?: string;
  name?: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissive_intensity?: number;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  capture?: boolean;
}

export async function build_set_material_result(host: ToolHost, args: SetMaterialArgs): Promise<ToolResult>
{
  if (!host.connected)
  {
    return not_connected();
  }

  const { capture, ...changes } = args;
  const asked = Object.keys(changes).some((key) => key !== 'uuid' && key !== 'name');

  let payload: unknown;

  try
  {
    payload = await host.send('set_material', { ...changes });
  }
  catch (error)
  {
    return failure(`Updating the material failed ${describe_error(error)}`);
  }

  const edit = payload as Record<string, unknown> | null;

  if (typeof edit !== 'object' || edit === null || !Array.isArray(edit.materials))
  {
    return failure('The app returned a malformed material payload.');
  }

  const content: Array<ImageBlock | TextBlock> = [];

  if (capture === true)
  {
    await attach_capture(host, content);
  }

  content.push({ type: 'text', text: render_edit(edit, edit.materials as Array<Record<string, unknown>>, asked) });

  return { content };
}

export function register_material_tools(server: McpServer, host: BridgeHost): void
{
  server.registerTool(
    'set_material',
    {
      title: 'Edit an OHZI object material',
      description: 'Change the color, roughness, metalness, emissive, opacity, transparency or wireframe of one object\'s material in the running app and return the resulting material state. An object with a material keeps its children untouched; an object with none, such as an imported model root, has every material under it edited. Materials are shared by reference, so every mesh using an edited material changes; the result says when that happens in the current scene. Fields a material does not have (roughness on MeshBasicMaterial) are skipped and reported. The change is live only: it is not saved to code. Pass only a selector to read the current material values. Pass capture to get a screenshot of the result in the same call.',
      inputSchema: {
        uuid: z.string().optional().describe('Exact uuid from inspect_scene.'),
        name: z.string().optional().describe('Exact object name.'),
        color: z.string().regex(HEX_COLOR).optional().describe('Base color as sRGB hex, for example \'#ff8800\'.'),
        roughness: z.number().min(0).max(1).optional().describe('0 is mirror smooth, 1 is fully rough.'),
        metalness: z.number().min(0).max(1).optional().describe('0 is dielectric, 1 is metal.'),
        emissive: z.string().regex(HEX_COLOR).optional().describe('Emitted color as sRGB hex. \'#000000\' turns emission off.'),
        emissive_intensity: z.number().min(0).optional().describe('Multiplier on emissive. Values above 1 feed bloom render modes.'),
        opacity: z.number().min(0).max(1).optional().describe('Below 1 also turns transparency on, so the change is visible.'),
        transparent: z.boolean().optional().describe('Set transparency explicitly. Pass false with opacity 1 to undo the transparency a lower opacity turned on.'),
        wireframe: z.boolean().optional().describe('Draw the mesh as wireframe.'),
        capture: z.boolean().optional().describe('Also return a screenshot of the result, so one call both acts and shows.')
      }
    },
    async (args) => build_set_material_result(host, args)
  );
}
