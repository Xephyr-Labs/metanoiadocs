// `mnSugg`: a suggested insertion or deletion, kept on the live page as a text
// attribute. See docs/superpowers/specs/2026-11-02-inline-suggestions-design.md.
//
// BlockSuite validates every format and insert against a zod object built from
// the inline specs its manager lists, and a zod object drops keys it does not
// know — so an unregistered `mnSugg` is silently stripped on the first edit.
// Registering a spec is not enough on its own: the paragraph's manager
// (DefaultInlineManager) is a fixed list. So the manager is overridden with the
// stock one plus this spec, last, which makes it the renderer that wins; it
// draws the run as BlockSuite would without the mark and wraps that.
import { DefaultInlineManagerExtension } from '@blocksuite/affine/inlines/preset';
import { type InlineManager, InlineSpecExtension, type InlineSpecs } from '@blocksuite/affine/std/inline';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { html } from 'lit';
import { z } from 'zod';

export interface Suggestion {
  id: string;
  kind: 'ins' | 'del';
  /** User id of the suggester. */
  by: string;
  /** Epoch ms. */
  at: number;
  via?: 'ai';
}

const schema = z
  .object({ id: z.string(), kind: z.enum(['ins', 'del']), by: z.string(), at: z.number(), via: z.literal('ai').optional() })
  .optional()
  .nullable()
  .catch(undefined);

type Manager = InlineManager<AffineTextAttributes>;
type Provider = { get: <T>(id: unknown) => T };
type Di = { override: (id: unknown, f: (p: Provider) => unknown) => void };

const SuggSpec = InlineSpecExtension('mnSugg', (provider) => ({
  name: 'mnSugg',
  schema,
  match: (delta) => !!(delta.attributes as { mnSugg?: Suggestion } | undefined)?.mnSugg,
  renderer: (props) => {
    const { mnSugg, ...rest } = props.delta.attributes as AffineTextAttributes & { mnSugg: Suggestion };
    // The stripped delta no longer matches this spec, so the manager hands it
    // to whichever would have drawn it — bold, link, reference…
    const inner = provider.get<Manager>(DefaultInlineManagerExtension.identifier)
      .getRenderer()({ ...props, delta: { ...props.delta, attributes: rest } });
    return mnSugg.kind === 'del'
      ? html`<del class="mn-sugg-del" data-sugg-id=${mnSugg.id}>${inner}</del>`
      : html`<ins class="mn-sugg-ins" data-sugg-id=${mnSugg.id}>${inner}</ins>`;
  },
}) as InlineSpecs);

/** Must come after the view's own extensions: it overrides their manager. */
export function suggestInlineExtensions(): ExtensionType[] {
  // BlockSuite's own factory for the manager, caught rather than copied, so its
  // spec list stays BlockSuite's across upgrades.
  let stock: ((p: Provider) => Manager) | undefined;
  DefaultInlineManagerExtension.setup({ addImpl: (_: unknown, f: typeof stock) => { stock = f; } } as never);
  return [
    SuggSpec,
    {
      setup: (di) => (di as unknown as Di).override(DefaultInlineManagerExtension.identifier, (p) => {
        const manager = stock!(p);
        (manager.specs as InlineSpecs[]).push(p.get(SuggSpec.identifier));
        return manager;
      }),
    },
  ];
}
