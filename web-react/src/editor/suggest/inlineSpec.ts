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
import { LifeCycleWatcher } from '@blocksuite/affine/std';
import { type InlineManager, InlineSpecExtension, type InlineSpecs } from '@blocksuite/affine/std/inline';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { html } from 'lit';
import type { Subject } from 'rxjs';
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
  try {
    DefaultInlineManagerExtension.setup({ addImpl: (_: unknown, f: typeof stock) => { stock = f; } } as never);
  } catch { /* reported just below */ }
  if (typeof stock !== 'function') {
    throw new Error('BlockSuite DefaultInlineManagerExtension shape changed: mnSugg inline spec cannot register');
  }
  const build = stock;
  return [
    SuggSpec,
    {
      setup: (di) => (di as unknown as Di).override(DefaultInlineManagerExtension.identifier, (p) => {
        const manager = build(p);
        // `specs` is typed readonly but is a plain array, and getSchema,
        // getRenderer and embedChecker all read it lazily on each call, so a
        // spec pushed here takes part in validation and rendering like the rest.
        (manager.specs as InlineSpecs[]).push(p.get(SuggSpec.identifier));
        return manager;
      }),
    },
  ];
}

type Json = { [k: string]: unknown };

/**
 * A copy is a snapshot, and a snapshot's text deltas and block props carry the
 * suggestion with its id. Pasted anywhere, that would be a second run answering
 * to the same card — so the mark never travels; the text arrives as plain text.
 */
export function stripSuggestions(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(stripSuggestions);
  if (!node || typeof node !== 'object') return;
  const o = node as Json;
  if ('insert' in o && o.attributes && typeof o.attributes === 'object') delete (o.attributes as Json).mnSugg;
  if ('flavour' in o && o.props && typeof o.props === 'object') delete (o.props as Json).mnSugg;
  for (const v of Object.values(o)) stripSuggestions(v);
}

type Slots = { beforeImport: Subject<{ snapshot: unknown }>; afterExport: Subject<{ snapshot: unknown }> };

/** A clipboard middleware: nothing suggested leaves on copy or arrives on paste. */
export const stripSuggestionsMiddleware = ({ slots }: { slots: Slots }) => {
  slots.afterExport.subscribe(({ snapshot }) => stripSuggestions(snapshot));
  slots.beforeImport.subscribe(({ snapshot }) => stripSuggestions(snapshot));
};

class StripSuggestionsOnCopy extends LifeCycleWatcher {
  static override key = 'mn-strip-suggestions';
  override mounted() {
    this.std.clipboard.use(stripSuggestionsMiddleware as never);
  }
  override unmounted() {
    this.std.clipboard.unuse(stripSuggestionsMiddleware as never);
  }
}

export const stripSuggestionsOnCopyExtension: ExtensionType = StripSuggestionsOnCopy;
