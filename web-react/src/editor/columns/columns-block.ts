// Views for the two column blocks. Both render to light DOM (like every other
// metanoia block here), so their styling lives in index.css.
import { BlockComponent } from '@blocksuite/std';
import { html, nothing } from 'lit';
import {
  MIN_COLUMN_SHARE,
  type MetanoiaColumnBlockModel, type MetanoiaColumnsBlockModel,
} from './columns-model';

const shareOf = (model: { props?: { width?: number } }): number => {
  const w = model.props?.width;
  return typeof w === 'number' && w > 0 ? w : 1;
};

export class MetanoiaColumnsBlockComponent extends BlockComponent<MetanoiaColumnsBlockModel> {
  override renderBlock() {
    return html`<div class="mn-cols">${this.renderChildren(this.model)}</div>`;
  }
}

export class MetanoiaColumnBlockComponent extends BlockComponent<MetanoiaColumnBlockModel> {
  /** Drag the gutter to move width between this column and the one before it.
   *  The pair's total share never changes, so the rest of the row holds still. */
  private readonly onGripDown = (event: PointerEvent) => {
    const previous = this.previousElementSibling as HTMLElement | null;
    const siblings = this.store.getParent(this.model)?.children ?? [];
    const previousModel = siblings[siblings.indexOf(this.model) - 1] as MetanoiaColumnBlockModel | undefined;
    if (!previous || !previousModel || this.store.readonly) return;
    // Without this BlockSuite starts a text selection across the row.
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const previousWidth = previous.getBoundingClientRect().width;
    const ownWidth = this.getBoundingClientRect().width;
    const pixels = previousWidth + ownWidth;
    const shares = shareOf(previousModel) + shareOf(this.model);
    if (pixels <= 0) return;
    let previousShare = shareOf(previousModel);
    let ownShare = shareOf(this.model);

    // Capture phase, on window: BlockSuite's event dispatcher swallows
    // pointermove inside the editor (that is how it drives its own drags), so a
    // plain bubble listener here sees the pointerup and none of the moves.
    const move = (moveEvent: PointerEvent) => {
      const limit = MIN_COLUMN_SHARE * pixels;
      const dx = Math.min(Math.max(moveEvent.clientX - startX, limit - previousWidth), ownWidth - limit);
      previousShare = (shares * (previousWidth + dx)) / pixels;
      ownShare = (shares * (ownWidth - dx)) / pixels;
      previous.style.flexGrow = String(previousShare);
      this.style.flexGrow = String(ownShare);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      // One entry in the undo stack for the whole drag, not one per frame.
      this.store.captureSync();
      this.store.updateBlock(previousModel, { width: previousShare });
      this.store.updateBlock(this.model, { width: ownShare });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, { once: true, capture: true });
  };

  override updated() {
    // The host is the flex item, so the stored share goes on the element rather
    // than into the template.
    this.style.flexGrow = String(shareOf(this.model));
  }

  override renderBlock() {
    // No gutter for a public viewer or a version preview: the handle does
    // nothing there, and a col-resize cursor over it promises otherwise.
    // `readonly` is settled before the editor mounts, so it needs no reactivity.
    return html`
      ${this.store.readonly
        ? nothing
        : html`<div class="mn-col-grip" contenteditable="false" @pointerdown=${this.onGripDown}></div>`}
      <div class="mn-col-body">${this.renderChildren(this.model)}</div>
    `;
  }
}
