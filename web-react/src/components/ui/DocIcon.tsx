import { FileText, Folder } from 'lucide-react';

/** Minimalist monochrome doc icon: Folder when the page has children, File otherwise. */
export function DocIcon({ hasChildren = false, size = 16, className = 'shrink-0 text-faint' }: { hasChildren?: boolean; size?: number; className?: string }) {
  const Icon = hasChildren ? Folder : FileText;
  return <Icon size={size} strokeWidth={1.75} className={className} />;
}
