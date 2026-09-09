import { SlashMenuConfigExtension } from '@blocksuite/affine-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';
import { COLUMN_FLAVOUR, COLUMNS_FLAVOUR } from './columns-model';
import { columnsSlashMenuConfig } from './columns-slash';

export const columnsViewExtensions: ExtensionType[] = [
  FlavourExtension(COLUMNS_FLAVOUR),
  FlavourExtension(COLUMN_FLAVOUR),
  BlockViewExtension(COLUMNS_FLAVOUR, literal`metanoia-columns`),
  BlockViewExtension(COLUMN_FLAVOUR, literal`metanoia-column`),
  SlashMenuConfigExtension(COLUMNS_FLAVOUR, columnsSlashMenuConfig),
];
