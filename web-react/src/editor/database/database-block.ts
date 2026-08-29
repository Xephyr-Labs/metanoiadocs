import { BlockComponent } from '@blocksuite/std';
import { html } from 'lit';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmbeddedDatabase } from '../../components/project/EmbeddedDatabase';
import { defaultDatabaseProps, type DatabaseBlockProps, type MetanoiaDatabaseBlockModel } from './database-model';

export class MetanoiaDatabaseBlockComponent extends BlockComponent<MetanoiaDatabaseBlockModel> {
  private root: Root | null = null;

  // Mirrors the chart block's own accessor: `this.model.props` is not reliably
  // populated at the point `updated()` first fires, so read through the same
  // fallback every other prop read in this codebase uses.
  private get props(): DatabaseBlockProps {
    const raw = (this.model as unknown as { props?: unknown }).props ?? this.model;
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<DatabaseBlockProps>;
    const d = defaultDatabaseProps();
    return {
      projectId: typeof o.projectId === 'string' ? o.projectId : d.projectId,
      view: o.view === 'board' ? 'board' : 'table',
      height: typeof o.height === 'number' ? o.height : d.height,
    };
  }

  override disconnectedCallback() {
    // React roots must be unmounted asynchronously — unmounting inside a
    // lit lifecycle callback while React is rendering throws.
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
    super.disconnectedCallback();
  }

  override updated() {
    const host = this.querySelector('.mn-db-host');
    if (!host) return;
    const props = this.props;
    this.root ??= createRoot(host);
    this.root.render(
      createElement(EmbeddedDatabase, {
        projectId: props.projectId,
        view: props.view,
        onPick: (projectId: string) => this.store.updateBlock(this.model, { projectId }),
        onView: (view: 'board' | 'table') => this.store.updateBlock(this.model, { view }),
      }),
    );
  }

  override renderBlock() {
    return html`
      <div class="mn-db" style=${`min-height:${this.props.height}px`} contenteditable="false">
        <div class="mn-db-host"></div>
      </div>`;
  }
}
