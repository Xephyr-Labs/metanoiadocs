import { MetanoiaDatabaseBlockComponent } from './database-block';

let done = false;

export function databaseEffects(): void {
  if (done) return;
  done = true;
  if (!customElements.get('metanoia-database')) {
    customElements.define('metanoia-database', MetanoiaDatabaseBlockComponent as unknown as CustomElementConstructor);
  }
}
