import { BlockComponent } from '@blocksuite/std';
import { html } from 'lit';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmbeddedDatabase } from '../../components/project/EmbeddedDatabase';
import {
  defaultDatabaseProps, EMBEDDED_VIEWS,
  type DatabaseBlockProps, type EmbeddedView, type MetanoiaDatabaseBlockModel,
} from './database-model';

export class MetanoiaDatabaseBlockComponent extends BlockComponent<MetanoiaDatabaseBlockModel> {
  private root: Root | null = null;

  /**
   * Read defensively, and keep the schema version where it is.
   *
   * A database saved before width/header existed carries neither, and a
   * document written by an older build is the normal case, not the edge — so
   * every field is defaulted here rather than migrated. Bumping the block's
   * schema version instead would make those older documents fail validation
   * outright, which is a much worse answer to "this prop is missing".
   */
  private get props(): DatabaseBlockProps {
    const raw = (this.model as unknown as { props?: unknown }).props ?? this.model;
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<DatabaseBlockProps>;
    const d = defaultDatabaseProps();
    return {
      projectId: typeof o.projectId === 'string' ? o.projectId : d.projectId,
      viewId: typeof o.viewId === 'string' ? o.viewId : d.viewId,
      view: EMBEDDED_VIEWS.includes(o.view as EmbeddedView) ? (o.view as EmbeddedView) : d.view,
      width: o.width === 'full' ? 'full' : 'column',
      header: typeof o.header === 'boolean' ? o.header : d.header,
      height: typeof o.height === 'number' ? o.height : d.height,
    };
  }

  override disconnectedCallback() {
    const root = this.root;
    this.root = null;
    if (root) queueMicrotask(() => root.unmount());
    super.disconnectedCallback();
  }

  override updated() {
    const host = this.querySelector('.mn-db-host');
    if (!host) return;
    const props = this.props;
    const set = (patch: Partial<DatabaseBlockProps>) => this.store.updateBlock(this.model, patch);
    this.root ??= createRoot(host);
    this.root.render(
      createElement(EmbeddedDatabase, {
        projectId: props.projectId,
        viewId: props.viewId,
        width: props.width,
        header: props.header,
        height: props.height,
        unavailable: this.store.readonly,
        readonly: this.store.readonly,
        // Picking a different database invalidates the view this block named.
        onPick: (projectId: string) => set({ projectId, viewId: '' }),
        onView: (viewId: string) => set({ viewId }),
        onWidth: (width: 'column' | 'full') => set({ width }),
        onHeader: (header: boolean) => set({ header }),
        onHeight: (height: number) => set({ height }),
      }),
    );
  }

  override renderBlock() {
    const { width } = this.props;
    // The wrapper keeps the note's width whatever the block does — the
    // breakout is measured against it, so it has to stay put. See useBreakout.
    return html`
      <div class="mn-db" data-width=${width} contenteditable="false">
        <div class="mn-db-host"></div>
      </div>`;
  }
}
