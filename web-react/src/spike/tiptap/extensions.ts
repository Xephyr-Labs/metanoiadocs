// SPIKE: the Tiptap schema a converted page lives in.
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';

export const spikeExtensions = (opts: { collab?: boolean } = {}) => [
  // Collaboration brings its own undo (Yjs), so StarterKit's goes.
  StarterKit.configure({ link: { openOnClick: false }, ...(opts.collab ? { undoRedo: false } : {}) }),
  TableKit,
  Image,
  TaskList,
  TaskItem.configure({ nested: true }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
];
