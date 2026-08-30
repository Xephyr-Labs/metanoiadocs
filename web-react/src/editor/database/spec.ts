import { SlashMenuConfigExtension } from '@blocksuite/affine-widget-slash-menu';
import { BlockViewExtension, FlavourExtension } from '@blocksuite/std';
import type { ExtensionType } from '@blocksuite/store';
import { literal } from 'lit/static-html.js';
import { DATABASE_FLAVOUR } from './database-model';
import { databaseSlashMenuConfig } from './database-slash';

export const databaseViewExtensions: ExtensionType[] = [
  FlavourExtension(DATABASE_FLAVOUR),
  BlockViewExtension(DATABASE_FLAVOUR, literal`metanoia-database`),
  SlashMenuConfigExtension(DATABASE_FLAVOUR, databaseSlashMenuConfig),
];
