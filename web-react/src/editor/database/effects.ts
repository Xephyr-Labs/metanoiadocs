import { SurfaceBlockSchema } from '@blocksuite/affine-block-surface';
import { MetanoiaDatabaseBlockComponent } from './database-block';
import { DATABASE_FLAVOUR } from './database-model';

let done = false;

export function databaseEffects(): void {
  if (done) return;
  done = true;
  if (!customElements.get('metanoia-database')) {
    customElements.define('metanoia-database', MetanoiaDatabaseBlockComponent as unknown as CustomElementConstructor);
  }

  // Allow a database to live directly on the edgeless surface (like image/frame).
  // The surface schema's children is a closed allowlist; without this a database
  // parented to affine:surface is rejected by schema validation and never
  // rendered as a standalone gfx element. The validator reads this array live.
  try {
    const children = SurfaceBlockSchema.model.children as string[] | undefined;
    if (children && !children.includes(DATABASE_FLAVOUR)) children.push(DATABASE_FLAVOUR);
  } catch { /* array frozen: database still works in page + note-embedded edgeless */ }
}
