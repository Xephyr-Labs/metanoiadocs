import { AffineSchemas } from '@blocksuite/affine/schemas';
import { MetanoiaColumnBlockComponent, MetanoiaColumnsBlockComponent } from './columns-block';
import { allowColumnChildren } from './columns-model';

let done = false;

export function columnsEffects(): void {
  if (done) return;
  done = true;
  if (!customElements.get('metanoia-columns')) {
    customElements.define('metanoia-columns', MetanoiaColumnsBlockComponent as unknown as CustomElementConstructor);
  }
  if (!customElements.get('metanoia-column')) {
    customElements.define('metanoia-column', MetanoiaColumnBlockComponent as unknown as CustomElementConstructor);
  }
  // Anything a note accepts, a column accepts. See allowColumnChildren.
  allowColumnChildren(AffineSchemas);
}
