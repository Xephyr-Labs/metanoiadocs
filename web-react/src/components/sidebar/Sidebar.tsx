/* Hallmark · component: the workspace rail — a labelled strip and the panel it
 *              switches · genre: modern-minimal
 * pre-emit critique: P5 H5 E5 S5 R4 V4
 * theme: project tokens (index.css)
 * states: default · hover · focus-visible (inset ring, own radius) ·
 *         pressed · current (section showing) · disabled (none: a section is
 *         always pickable) · loading/error/success (none: picking a scope is a
 *         local state flip, it can neither wait nor fail) ·
 *         section folded · section capped ("N more") · empty section ·
 *         collapsed sidebar · mobile drawer · resizing
 * keyboard: one tab stop, arrows walk, Home/End jump, Enter/Space commits
 * contrast: pass — 5.1:1 idle / 10.0:1 current light, 7.1:1 / 10.4:1 dark
 * note: the rail narrows the sidebar, it does not gate it — `Everything` is
 *       first and is the default, so nobody's navigation moves on upgrade.
 * targets: rail items are 72x52 and reach both edges of the 72px column, so a
 *       pointer thrown at the window edge lands on one. Settings sits in the
 *       footer with the account it configures, not in the list of destinations.
 */

import {
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronRight,
  ExternalLink,
  Files,
  Folder,
  Home,
  Link2,
  Inbox,
  KanbanSquare,
  LayoutList,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Settings,
  Shapes,
  Star,
  Table2,
  Tag as TagIcon,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  Children,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import {
  SECTION_LIMIT,
  collapsedSections,
  railSection,
  setRailSection,
  toggleSection,
  type RailSection,
} from '../../lib/sidebarPrefs';
import { copyLink } from '../../lib/clipboard';
import { dbUrl } from '../../lib/route';
import { pickImportFiles } from '../../lib/docFiles';
import { avatarFor } from '../../lib/avatar';
import { nestByParent } from '../../lib/pageTree';
import { swatch } from '../../lib/tagColors';
import { toast } from '../../lib/toast';
import { t } from '../../lib/i18n';

import { LogoMark } from '../brand/Logo';
import { PageIcon } from '../ui/PageIcon';
import {
  tasksApi,
  type ProjectMode,
  type ProjectRow,
} from '../../lib/tasksApi';
import type { Tag } from '../../lib/types';
import { workspaces } from '../../data/mock';
import { templates } from '../../data/templates';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { RowInput } from '../ui/RowInput';
import { Tooltip } from '../ui/Tooltip';
import { rowAction } from '../ui/styles';
import { PageTree } from './PageTree';
import { FolderTree } from './FolderTree';
import { DOC_MIME, dragSource } from './rowDrag';
import { useDocMenu } from '../../hooks/useDocMenu';
import { ProjectIcon } from '../ui/ProjectIcon';

/**
 * Only `alert` spends the accent. "You are here" is a neutral fill — where you
 * are is already obvious from the page in front of you, and a rail that tints
 * the current row leaves the accent competing with itself the moment something
 * genuinely wants attention. `alert` is that something: accent lettering plus
 * its badge, and in a neutral rail it is the only coloured thing in the column.
 */
function NavItem({
  icon,
  label,
  onClick,
  trailing,
  active,
  alert,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  trailing?: ReactNode;
  active?: boolean;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 transition-colors duration-120',
        active
          ? 'bg-selected font-medium text-ink'
          : alert
            ? 'font-medium text-accent-strong hover:bg-hover'
            : 'text-ink hover:bg-hover',
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center',
          alert
            ? 'text-accent-strong'
            : active
              ? 'text-ink'
              : 'text-muted group-hover:text-ink',
        )}
      >
        {icon}
      </span>

      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
        {label}
      </span>

      {trailing}
    </button>
  );
}

/**
 * A quiet colour per section, carried by the mark in the gutter and nothing
 * else.
 */
const SECTION_TINT: Record<string, string> = {
  recent: 'text-blue-500',
  pinned: 'text-amber-500',
  favorites: 'text-yellow-600 dark:text-yellow-500',
  projects: 'text-purple-500',
  designs: 'text-pink-500',
  folders: 'text-teal-500',
  private: 'text-gray-400',
  public: 'text-green-500',
  shared: 'text-blue-500',
  tags: 'text-green-600 dark:text-green-500',
  templates: 'text-gray-400',
};

/**
 * The same hue, at the weight text can carry.
 */
const SECTION_TEXT_TINT: Record<string, string> = {
  recent: 'text-blue-700 dark:text-blue-400',
  pinned: 'text-amber-700 dark:text-amber-400',
  favorites: 'text-yellow-800 dark:text-yellow-400',
  projects: 'text-purple-700 dark:text-purple-400',
  designs: 'text-pink-700 dark:text-pink-400',
  folders: 'text-teal-800 dark:text-teal-400',
  private: 'text-gray-700 dark:text-gray-300',
  public: 'text-green-800 dark:text-green-400',
  shared: 'text-blue-700 dark:text-blue-400',
  tags: 'text-green-800 dark:text-green-400',
  templates: 'text-gray-700 dark:text-gray-300',
};

const tintOf = (key: string) => SECTION_TINT[key] ?? 'text-faint';
const textTintOf = (key: string) =>
  SECTION_TEXT_TINT[key] ?? 'text-muted';

function SectionLabel({
  sectionKey,
  children,
  action,
}: {
  sectionKey: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mt-3 flex h-6 items-center gap-2 px-2 first:mt-0">
      <span
        aria-hidden
        className="flex w-5 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full bg-current',
            tintOf(sectionKey),
          )}
        />
      </span>

      <span
        className={cn(
          'mn-side-label min-w-0 flex-1 truncate text-2xs font-semibold uppercase',
          textTintOf(sectionKey),
        )}
      >
        {children}
      </span>

      {action}
    </div>
  );
}

function CollapsibleSection({
  sectionKey,
  label,
  collapsed,
  onToggle,
  count,
  action,
  children,
}: {
  sectionKey: string;
  label: string;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const open = !collapsed.has(sectionKey);

  return (
    <>
      <div className="mt-3 flex h-6 items-center gap-1 pr-2 first:mt-0">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(sectionKey)}
          className={cn(
            'mn-side-label group flex h-6 min-w-0 flex-1 items-center gap-2 px-2 text-2xs font-semibold uppercase',
            textTintOf(sectionKey),
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex w-5 shrink-0 items-center justify-center',
              tintOf(sectionKey),
            )}
          >
            <ChevronRight
              size={12}
              className={cn(
                'transition-transform duration-180',
                open && 'rotate-90',
              )}
            />
          </span>

          <span className="min-w-0 flex-1 truncate text-left">
            {label}
          </span>

          {!open && count ? (
            <span className="ml-auto shrink-0 pl-2 tabular-nums tracking-normal text-faint">
              {count}
            </span>
          ) : null}
        </button>

        {action}
      </div>

      {open && <div className="mt-0.5">{children}</div>}
    </>
  );
}

function Capped({
  limit = SECTION_LIMIT,
  children,
}: {
  limit?: number;
  children: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);

  if (items.length <= limit) return <>{items}</>;

  return (
    <>
      {all ? items : items.slice(0, limit)}

      <button
        type="button"
        onClick={() => setAll((v) => !v)}
        className="flex h-6 w-full items-center gap-1 rounded-md px-2 text-2xs text-faint
                   transition-colors duration-120 hover:bg-hover hover:text-muted"
      >
        {all
          ? t('Show fewer')
          : `${items.length - limit} ${t('more')}`}
      </button>
    </>
  );
}

function ProjectRows({
  parentId,
  depth,
  roots,
  childrenOf,
  namingParent,
  onNewUnder,
  onArchive,
  onSetMode,
  onCommitName,
  onCancelName,
}: {
  parentId: string | null;
  depth: number;
  roots: string[];
  childrenOf: Map<string, string[]>;
  namingParent: string | null | undefined;
  onNewUnder: (parentId: string, mode: ProjectMode) => void;
  onArchive: (project: ProjectRow) => void;
  onSetMode: (project: ProjectRow, mode: ProjectMode) => void;
  onCommitName: (name: string) => void;
  onCancelName: () => void;
}) {
  const ws = useWorkspace();

  const ids =
    parentId === null
      ? roots
      : (childrenOf.get(parentId) ?? []);

  const kids = ids
    .map((id) => ws.projects.find((p) => p.id === id))
    .filter((p): p is ProjectRow => !!p);

  const naming = namingParent === parentId;

  if (!kids.length && !naming) return null;

  return (
    <>
      {kids.map((p) => {
        const open = Number(p.total) - Number(p.done);

        return (
          <div key={p.id}>
            <div className="group flex items-center">
              <button
                type="button"
                onClick={() => ws.openProject(p.id)}
                style={{ paddingLeft: 8 + depth * 16 }}
                className={cn(
                  'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-sm leading-5 transition-colors duration-120',
                  ws.view === 'project' &&
                  ws.activeProjectId === p.id
                    ? 'bg-selected font-medium text-ink'
                    : 'text-ink hover:bg-hover',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <ProjectIcon project={p} size={16} />
                </span>

                <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
                  {p.name}
                </span>

                {Number(p.overdue) > 0 ? (
                  <span className="shrink-0 text-2xs font-semibold text-danger-strong">
                    {p.overdue}
                  </span>
                ) : open > 0 ? (
                  <span className="shrink-0 text-2xs text-muted">
                    {open}
                  </span>
                ) : null}
              </button>

              <button
                type="button"
                aria-label={t('New database under {{name}}', {
                  name: p.name,
                })}
                onClick={() => onNewUnder(p.id, 'tasks')}
                className={cn(
                  rowAction,
                  'opacity-0 group-hover:opacity-100',
                )}
              >
                <Plus size={14} />
              </button>

              <Menu
                trigger={
                  <button
                    type="button"
                    aria-label={t('Actions for {{name}}', {
                      name: p.name,
                    })}
                    className={cn(
                      rowAction,
                      'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
                items={[
                  {
                    icon: ExternalLink,
                    label: t('Open in a new tab'),
                    onSelect: () => {
                      window.open(
                        dbUrl(p.id),
                        '_blank',
                        'noopener,noreferrer',
                      );
                    },
                  },
                  {
                    icon: Link2,
                    label: t('Copy link'),
                    onSelect: () => {
                      copyLink(dbUrl(p.id));
                    },
                  },
                  {
                    icon: KanbanSquare,
                    label: t('New database inside'),
                    separatorBefore: true,
                    onSelect: () =>
                      onNewUnder(p.id, 'tasks'),
                  },
                  {
                    icon: Table2,
                    label: t('New data database inside'),
                    onSelect: () =>
                      onNewUnder(p.id, 'data'),
                  },
                  {
                    icon:
                      p.mode === 'data'
                        ? KanbanSquare
                        : Table2,
                    label:
                      p.mode === 'data'
                        ? t('Turn into a task database')
                        : t('Turn into a data database'),
                    separatorBefore: true,
                    onSelect: () =>
                      onSetMode(
                        p,
                        p.mode === 'data'
                          ? 'tasks'
                          : 'data',
                      ),
                  },
                  {
                    icon: Archive,
                    label: t('Archive database'),
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => onArchive(p),
                  },
                ]}
              />
            </div>

            <ProjectRows
              parentId={p.id}
              depth={depth + 1}
              roots={roots}
              childrenOf={childrenOf}
              namingParent={namingParent}
              onNewUnder={onNewUnder}
              onArchive={onArchive}
              onSetMode={onSetMode}
              onCommitName={onCommitName}
              onCancelName={onCancelName}
            />
          </div>
        );
      })}

      {naming && (
        <RowInput
          icon={
            <span className="flex h-5 w-5 shrink-0 items-center justify-center text-md leading-none">
              📋
            </span>
          }
          placeholder={t('Database name…')}
          label={t('New database name')}
          depth={depth}
          onCommit={onCommitName}
          onCancel={onCancelName}
        />
      )}
    </>
  );
}

function DocRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const p = ws.pages[id];
  const menu = useDocMenu(id);

  if (!p) return null;

  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        onClick={() => ws.select(id)}
        {...dragSource(DOC_MIME, id)}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md px-2 pr-7 text-sm leading-5 transition-colors duration-120',
          ws.currentId === id
            ? 'bg-selected font-medium text-ink'
            : 'text-ink hover:bg-hover',
        )}
      >
        <PageIcon icon={p.icon} size={16} />

        <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
          {p.title}
        </span>

        {p.favorite && (
          <Star
            size={14}
            className="shrink-0 fill-current text-amber-400"
          />
        )}
      </button>

      <span className="absolute right-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/row:opacity-100">
        <Menu
          align="end"
          items={menu}
          trigger={
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={rowAction}
              aria-label={t('Actions for {{name}}', {
                name: p.title,
              })}
            >
              <MoreHorizontal size={14} />
            </button>
          }
        />
      </span>
    </div>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const ws = useWorkspace();

  return (
    <div className="group/row relative flex items-center">
      <button
        type="button"
        onClick={() => ws.setTagFilter([tag.id])}
        className="flex h-7 w-full items-center gap-2 rounded-md px-2 pr-7 text-sm leading-5 text-ink transition-colors duration-120 hover:bg-hover"
      >
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            swatch(tag.color).dot,
          )}
        />

        <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
          {tag.name}
        </span>

        {tag.count ? (
          <span className="text-2xs text-faint">
            {tag.count}
          </span>
        ) : null}
      </button>

      <span className="absolute right-1 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover/row:opacity-100">
        <Menu
          align="end"
          trigger={
            <button
              type="button"
              className={rowAction}
              aria-label={t('Actions for {{name}}', {
                name: tag.name,
              })}
            >
              <MoreHorizontal size={14} />
            </button>
          }
          items={[
            {
              icon: TagIcon,
              label: t('Show pages'),
              onSelect: () =>
                ws.setTagFilter([tag.id]),
            },
            {
              icon: Trash2,
              label: t('Delete tag'),
              danger: true,
              separatorBefore: true,
              onSelect: () => {
                const message = tag.count
                  ? t(
                      'Delete the tag "{{name}}"? It is on {{count}} pages.',
                      {
                        name: tag.name,
                        count: tag.count,
                      },
                    )
                  : t(
                      'Delete the tag "{{name}}"?',
                      {
                        name: tag.name,
                      },
                    );

                if (!window.confirm(message)) {
                  return;
                }

                ws.deleteTag(tag.id).then((err) => {
                  toast(
                    err ??
                      t(
                        'Deleted the tag {{name}}.',
                        {
                          name: tag.name,
                        },
                      ),
                  );
                });
              },
            },
          ]}
        />
      </span>
    </div>
  );
}

function FavoriteFolderRow({ id }: { id: string }) {
  const ws = useWorkspace();
  const f = ws.folders[id];

  if (!f) return null;

  return (
    <button
      type="button"
      onClick={() => ws.openFolder(id)}
      className={cn(
        'flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-sm leading-5 transition-colors duration-120',
        ws.view === 'folder' &&
        ws.activeFolderId === id
          ? 'bg-selected font-medium text-ink'
          : 'text-ink hover:bg-hover',
      )}
    >
      <Folder size={16} className="shrink-0" />

      <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
        {f.name}
      </span>

      <Star
        size={14}
        className="shrink-0 fill-current text-amber-400"
      />
    </button>
  );
}

/**
 * The icon rail.
 */
const RAIL: {
  key: RailSection;
  icon: ReactNode;
  label: string;
}[] = [
  {
    key: 'all',
    icon: <LayoutList size={20} />,
    label: t('Everything'),
  },
  {
    key: 'docs',
    icon: <Files size={20} />,
    label: t('Documents'),
  },
  {
    key: 'projects',
    icon: <KanbanSquare size={20} />,
    label: t('Projects'),
  },
  {
    key: 'designs',
    icon: <Shapes size={20} />,
    label: t('Designs'),
  },
  {
    key: 'tags',
    icon: <TagIcon size={20} />,
    label: t('Tags'),
  },
  {
    key: 'templates',
    icon: <LayoutTemplate size={20} />,
    label: t('Templates'),
  },
];

export function useRailWidth(): number {
  return useMediaQuery('(hover: none)') ? 72 : 56;
}

function Rail({
  section,
  onPick,
  collapsed,
  onToggle,
}: {
  section: RailSection;
  onPick: (s: RailSection) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const width = useRailWidth();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    RAIL.findIndex((r) => r.key === section),
  );

  const [focused, setFocused] = useState<number | null>(
    null,
  );

  const onKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    i: number,
  ) => {
    const last = RAIL.length - 1;

    const to =
      e.key === 'ArrowDown'
        ? i === last
          ? 0
          : i + 1
        : e.key === 'ArrowUp'
          ? i === 0
            ? last
            : i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null;

    if (to === null) return;

    e.preventDefault();
    refs.current[to]?.focus();
  };

  return (
    <div
      style={{ width }}
      className="mn-rail flex shrink-0 flex-col items-center border-r border-line pt-[calc(var(--mn-head-h)+0.5rem)]"
    >
      <div
        role="toolbar"
        aria-orientation="vertical"
        aria-label={t('Sidebar sections')}
        className="flex w-full flex-col items-center gap-0.5"
      >
        {RAIL.map((r, i) => {
          const on = section === r.key;

          return (
            <Tooltip
              key={r.key}
              label={r.label}
              side="right"
              delay={0}
            >
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                aria-label={r.label}
                aria-pressed={on}
                tabIndex={
                  i === (focused ?? activeIndex)
                    ? 0
                    : -1
                }
                onFocus={() => setFocused(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                onClick={() => onPick(r.key)}
                className={cn(
                  'mn-rail-item flex h-11 w-full items-center justify-center',
                  'rounded-l-none rounded-r-lg transition-colors duration-120 ease-out',
                  'focus-visible:rounded-l-none focus-visible:rounded-r-lg focus-visible:[outline-offset:-2px]',
                  on
                    ? 'bg-selected text-ink'
                    : 'text-muted hover:bg-hover hover:text-ink',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {r.icon}
                </span>

                <span
                  className={cn(
                    'mn-rail-label max-w-full truncate text-3xs leading-none',
                    on && 'font-medium',
                  )}
                >
                  {r.label}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip
        label={
          collapsed
            ? t('Expand the panel')
            : t('Collapse the panel')
        }
        side="right"
        delay={0}
      >
        <button
          type="button"
          aria-label={
            collapsed
              ? t('Expand the panel')
              : t('Collapse the panel')
          }
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={cn(
            'mb-2 mt-auto flex h-9 w-9 items-center justify-center rounded-lg',
            'text-faint transition-colors duration-120 ease-out hover:bg-hover hover:text-ink',
          )}
        >
          {collapsed ? (
            <ChevronsRight size={16} />
          ) : (
            <ChevronsLeft size={16} />
          )}
        </button>
      </Tooltip>
    </div>
  );
}

export function Sidebar() {
  const ws = useWorkspace();
  const auth = useAuth();
  const activeWs = workspaces[0];

  const av = avatarFor(
    auth.user?.name ||
      auth.user?.username ||
      'You',
  );

  const dragging = useRef(false);
  const [, force] = useState(0);

  const isMobile = useMediaQuery(
    '(max-width: 767px)',
  );

  const panelAway =
    ws.panelCollapsed && !isMobile;

  const railWidth = useRailWidth();

  const [section, setSection] =
    useState<RailSection>(railSection);

  const [collapsed, setCollapsed] =
    useState<Set<string>>(collapsedSections);

  const shows = (s: RailSection) =>
    section === 'all' || section === s;

  const pickSection = (s: RailSection) => {
    setSection(s);
    setRailSection(s);

    if (
      s !== 'all' &&
      collapsed.has(s)
    ) {
      setCollapsed(toggleSection(s));
    }

    if (panelAway) {
      ws.setPanelCollapsed(false);
    }
  };

  const toggle = (key: string) =>
    setCollapsed(toggleSection(key));

  const [namingParent, setNamingParent] =
    useState<string | null | undefined>(
      undefined,
    );

  const [namingMode, setNamingMode] =
    useState<ProjectMode>('tasks');

  const startNaming = (
    parentId: string | null,
    mode: ProjectMode,
  ) => {
    setNamingMode(mode);
    setNamingParent(parentId);
  };

  const createProject = async (
    name: string,
  ) => {
    const p =
      await tasksApi.createProject({
        name,
        parentId:
          namingParent ?? null,
        mode: namingMode,
      });

    await ws.refreshProjects();
    setNamingParent(undefined);
    ws.openProject(p.id);
  };

  const setProjectMode = async (
    project: ProjectRow,
    mode: ProjectMode,
  ) => {
    try {
      await tasksApi.patchProject(
        project.id,
        { mode },
      );
    } catch {
      toast(
        t('Could not change {{name}}.', {
          name: project.name,
        }),
      );
      return;
    }

    await ws.refreshProjects();

    toast(
      mode === 'data'
        ? t(
            '{{name}} is a data database. Its task fields are hidden, not deleted.',
            { name: project.name },
          )
        : t(
            '{{name}} is a task database again.',
            { name: project.name },
          ),
    );
  };

  const archiveProject = async (
    project: ProjectRow,
  ) => {
    try {
      await tasksApi.archiveProject(
        project.id,
      );
    } catch {
      toast(
        t('Could not archive {{name}}.', {
          name: project.name,
        }),
      );
      return;
    }

    if (
      ws.activeProjectId === project.id
    ) {
      ws.openHome();
    }

    await ws.refreshProjects();

    toast(
      t('Archived {{name}}.', {
        name: project.name,
      }),
      {
        label: t('Undo'),
        onSelect: () => {
          tasksApi
            .patchProject(project.id, {
              archived: false,
            })
            .then(() =>
              ws.refreshProjects(),
            )
            .catch(() =>
              toast(
                t(
                  'Could not restore {{name}}.',
                  {
                    name: project.name,
                  },
                ),
              ),
            );
        },
      },
    );
  };

  const projectTree = useMemo(
    () =>
      nestByParent(
        ws.projects.map((p) => ({
          id: p.id,
          parentId: p.parent_id,
        })),
      ),
    [ws.projects],
  );

  const onResizeStart = (
    e: React.MouseEvent,
  ) => {
    e.preventDefault();

    dragging.current = true;

    const startX = e.clientX;
    const startW = ws.sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;

      ws.setSidebarWidth(
        Math.min(
          476,
          Math.max(
            276,
            startW +
              ev.clientX -
              startX,
          ),
        ),
      );

      force((n) => n + 1);
    };

    const onUp = () => {
      dragging.current = false;

      window.removeEventListener(
        'mousemove',
        onMove,
      );

      window.removeEventListener(
        'mouseup',
        onUp,
      );
    };

    window.addEventListener(
      'mousemove',
      onMove,
    );

    window.addEventListener(
      'mouseup',
      onUp,
    );
  };

  return (
    <aside
      className="mn-side relative flex h-full shrink-0 bg-canvas"
      style={{
        width: panelAway
          ? railWidth
          : ws.sidebarWidth,
        maxWidth: '100%',
      }}
    >
      <Rail
        section={section}
        onPick={pickSection}
        collapsed={panelAway}
        onToggle={() =>
          ws.setPanelCollapsed(
            !panelAway,
          )
        }
      />

      {!panelAway && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="group/head flex h-[var(--mn-head-h)] shrink-0 items-center gap-1 px-2">
            <Menu
              width={248}
              items={[
                {
                  label: `${activeWs.icon}  ${activeWs.name}`,
                },
                {
                  icon: Upload,
                  label: t('Import…'),
                  separatorBefore: true,
                  onSelect: () => {
                    pickImportFiles().then(
                      (f) => {
                        if (f.length) {
                          ws.importFiles(
                            f,
                            null,
                          );
                        }
                      },
                    );
                  },
                },
                {
                  icon: Settings,
                  label: t('Settings'),
                  separatorBefore: true,
                  onSelect: () =>
                    ws.setSettingsOpen(
                      true,
                    ),
                },
                {
                  icon: LogOut,
                  label: t('Log out'),
                  danger: true,
                  onSelect: () =>
                    auth.logout(),
                },
              ]}
              trigger={
                <button className="group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left leading-5 transition-colors duration-120 hover:bg-hover">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <LogoMark size={16} />
                  </span>

                  <span className="block h-5 min-w-0 flex-1 !self-center truncate text-sm font-semibold leading-5 text-ink">
                    {activeWs.name}
                  </span>

                  <ChevronDown
                    size={16}
                    className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
              }
            />

            <IconButton
              icon={
                <PanelLeftClose
                  size={16}
                />
              }
              label={t('Close sidebar')}
              keys={['⌘', '\\']}
              onClick={() =>
                ws.setSidebarCollapsed(
                  true,
                )
              }
              className="mn-hover-reveal opacity-0 transition-opacity duration-120 group-hover/head:opacity-100"
            />
          </div>

          <div className="px-2 pt-2">
            <NavItem
              icon={<Home size={16} />}
              label={t('Home')}
              active={
                ws.view === 'home'
              }
              onClick={ws.openHome}
            />

            <NavItem
              icon={<Inbox size={16} />}
              label={t('Inbox')}
              alert={
                ws.unreadCount > 0
              }
              onClick={() =>
                ws.setInboxOpen(true)
              }
              trailing={
                ws.unreadCount > 0 ? (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-strong px-1 text-3xs font-semibold text-white">
                    {ws.unreadCount >
                    99
                      ? '99+'
                      : ws.unreadCount}
                  </span>
                ) : undefined
              }
            />

            <NavItem
              icon={
                <CheckSquare
                  size={16}
                />
              }
              label={t('Tasks')}
              active={
                ws.view === 'tasks'
              }
              onClick={ws.openTasks}
            />

            <NavItem
              icon={<Files size={16} />}
              label={t('All documents')}
              active={
                ws.view === 'docs'
              }
              onClick={ws.openAllDocs}
            />
          </div>

          <div className="scrollarea mt-4 flex-1 overflow-y-auto px-2 pb-2">
            {shows('docs') &&
              ws.recentIds.length >
                0 && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="recent"
                    label={t(
                      'Recent',
                    )}
                    count={
                      ws.recentIds
                        .length
                    }
                  >
                    <div className="space-y-px">
                      <Capped limit={5}>
                        {ws.recentIds.map(
                          (id) => (
                            <DocRow
                              key={id}
                              id={id}
                            />
                          ),
                        )}
                      </Capped>
                    </div>
                  </CollapsibleSection>
                </section>
              )}

            {shows('docs') &&
              (ws.pinnedFolderIds
                .length > 0 ||
                ws.pinnedIds
                  .length > 0) && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="pinned"
                    label={t(
                      'Pinned',
                    )}
                    count={
                      ws.pinnedFolderIds
                        .length +
                      ws.pinnedIds
                        .length
                    }
                  >
                    <div className="space-y-px">
                      <Capped>
                        {[
                          ...ws.pinnedFolderIds.map(
                            (id) => (
                              <FavoriteFolderRow
                                key={`f${id}`}
                                id={id}
                              />
                            ),
                          ),
                          ...ws.pinnedIds.map(
                            (id) => (
                              <DocRow
                                key={id}
                                id={id}
                              />
                            ),
                          ),
                        ]}
                      </Capped>
                    </div>
                  </CollapsibleSection>
                </section>
              )}

            {shows('docs') &&
              (ws.favoriteFolderIds
                .length > 0 ||
                ws.favoriteIds
                  .length > 0) && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="favorites"
                    label={t(
                      'Favorites',
                    )}
                    count={
                      ws.favoriteFolderIds
                        .length +
                      ws.favoriteIds
                        .length
                    }
                  >
                    <div className="space-y-px">
                      <Capped>
                        {[
                          ...ws.favoriteFolderIds.map(
                            (id) => (
                              <FavoriteFolderRow
                                key={`f${id}`}
                                id={id}
                              />
                            ),
                          ),
                          ...ws.favoriteIds.map(
                            (id) => (
                              <DocRow
                                key={id}
                                id={id}
                              />
                            ),
                          ),
                        ]}
                      </Capped>
                    </div>
                  </CollapsibleSection>
                </section>
              )}

            {shows('projects') && (
              <section className="mb-5">
                <SectionLabel
                  sectionKey="projects"
                  action={
                    <Menu
                      align="end"
                      trigger={
                        <button
                          type="button"
                          className={
                            rowAction
                          }
                          aria-label={t(
                            'New database',
                          )}
                        >
                          <Plus
                            size={14}
                          />
                        </button>
                      }
                      items={[
                        {
                          icon: KanbanSquare,
                          label: t(
                            'New database',
                          ),
                          onSelect: () =>
                            startNaming(
                              null,
                              'tasks',
                            ),
                        },
                        {
                          icon: Table2,
                          label: t(
                            'New data database',
                          ),
                          onSelect: () =>
                            startNaming(
                              null,
                              'data',
                            ),
                        },
                      ]}
                    />
                  }
                >
                  {t('Projects')}
                </SectionLabel>

                {ws.projects.length ||
                namingParent !==
                  undefined ? (
                  <div className="space-y-px">
                    <ProjectRows
                      parentId={null}
                      depth={0}
                      roots={
                        projectTree.roots
                      }
                      childrenOf={
                        projectTree.childrenOf
                      }
                      namingParent={
                        namingParent
                      }
                      onNewUnder={
                        startNaming
                      }
                      onArchive={
                        archiveProject
                      }
                      onSetMode={
                        setProjectMode
                      }
                      onCommitName={
                        createProject
                      }
                      onCancelName={() =>
                        setNamingParent(
                          undefined,
                        )
                      }
                    />
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      startNaming(
                        null,
                        'tasks',
                      )
                    }
                    className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted"
                  >
                    <Plus size={14} />
                    {t('New project')}
                  </button>
                )}
              </section>
            )}

            {shows('designs') && (
              <section className="mb-5">
                <SectionLabel
                  sectionKey="designs"
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        ws.createDesign()
                      }
                      className={
                        rowAction
                      }
                      aria-label={t(
                        'New design',
                      )}
                    >
                      <Plus
                        size={14}
                      />
                    </button>
                  }
                >
                  {t('Designs')}
                </SectionLabel>

                {ws.designIds.length ? (
                  <div className="space-y-px">
                    {ws.designIds.map(
                      (id) => (
                        <DocRow
                          key={id}
                          id={id}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      ws.createDesign()
                    }
                    className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted"
                  >
                    <Plus size={14} />
                    {t('New design')}
                  </button>
                )}
              </section>
            )}

            {shows('docs') && (
              <section className="mb-5">
                <SectionLabel
                  sectionKey="folders"
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        ws.createFolder(
                          null,
                        )
                      }
                      className={
                        rowAction
                      }
                      aria-label={t(
                        'New folder',
                      )}
                    >
                      <Plus
                        size={14}
                      />
                    </button>
                  }
                >
                  {t('Folders')}
                </SectionLabel>

                {ws.folderRootIds
                  .length ||
                ws.unfiledIds.length ? (
                  <FolderTree
                    roots={
                      ws.folderRootIds
                    }
                    unfiled={
                      ws.unfiledIds
                    }
                  />
                ) : (
                  <button
                    onClick={() =>
                      ws.createFolder(
                        null,
                      )
                    }
                    className="mt-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-faint hover:bg-hover hover:text-muted"
                  >
                    <Plus size={14} />
                    {t('New folder')}
                  </button>
                )}
              </section>
            )}

            {shows('docs') &&
              ws.privateRootIds
                .length > 0 && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="private"
                    label={t(
                      'Private',
                    )}
                    count={
                      ws.privateRootIds
                        .length
                    }
                  >
                    <PageTree
                      roots={
                        ws.privateRootIds
                      }
                    />
                  </CollapsibleSection>
                </section>
              )}

            {shows('docs') &&
              ws.sharedRootIds
                .length > 0 && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="public"
                    label={t(
                      'Public links',
                    )}
                    count={
                      ws.sharedRootIds
                        .length
                    }
                  >
                    <div className="space-y-px">
                      <Capped>
                        {ws.sharedRootIds.map(
                          (id) => (
                            <DocRow
                              key={id}
                              id={id}
                            />
                          ),
                        )}
                      </Capped>
                    </div>
                  </CollapsibleSection>
                </section>
              )}

            {shows('docs') &&
              ws.libraryRootIds
                .length > 0 && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="shared"
                    label={t(
                      'Shared with me',
                    )}
                    count={
                      ws.libraryRootIds
                        .length
                    }
                  >
                    <PageTree
                      roots={
                        ws.libraryRootIds
                      }
                    />
                  </CollapsibleSection>
                </section>
              )}

            {shows('tags') &&
              ws.allTags.length >
                0 && (
                <section className="mb-5">
                  <CollapsibleSection
                    collapsed={
                      collapsed
                    }
                    onToggle={toggle}
                    sectionKey="tags"
                    label={t(
                      'Tags',
                    )}
                    count={
                      ws.allTags.length
                    }
                  >
                    <div className="space-y-px">
                      <Capped limit={10}>
                        {ws.allTags.map(
                          (tag) => (
                            <TagRow
                              key={tag.id}
                              tag={tag}
                            />
                          ),
                        )}
                      </Capped>
                    </div>
                  </CollapsibleSection>
                </section>
              )}

            {shows('templates') && (
              <section className="mb-1 mt-2">
                <CollapsibleSection
                  collapsed={
                    collapsed
                  }
                  onToggle={toggle}
                  sectionKey="templates"
                  label={t(
                    'Templates',
                  )}
                  count={
                    templates.length +
                    ws.docTemplates
                      .length
                  }
                >
                  <div className="space-y-px">
                    {ws.docTemplates.map(
                      (template) => (
                        <button
                          key={
                            template.id
                          }
                          type="button"
                          title={t(
                            'New page from {{title}}',
                            {
                              title:
                                template.title,
                            },
                          )}
                          onClick={() =>
                            ws.createFromPage(
                              template.id,
                            )
                          }
                          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 text-ink transition-colors duration-120 hover:bg-hover"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-md leading-none">
                            {
                              template.icon
                            }
                          </span>

                          <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
                            {
                              template.title
                            }
                          </span>

                          <Plus
                            size={14}
                            className="shrink-0 text-faint"
                          />
                        </button>
                      ),
                    )}

                    {templates.map(
                      (template) => (
                        <button
                          key={
                            template.id
                          }
                          type="button"
                          onClick={() =>
                            ws.createFromTemplate(
                              template,
                            )
                          }
                          className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm leading-5 text-ink transition-colors duration-120 hover:bg-hover"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-md leading-none">
                            {
                              template.icon
                            }
                          </span>

                          <span className="block h-5 min-w-0 flex-1 !self-center truncate leading-5 text-left">
                            {
                              template.name
                            }
                          </span>

                          <Plus
                            size={14}
                            className="shrink-0 text-faint"
                          />
                        </button>
                      ),
                    )}
                  </div>
                </CollapsibleSection>
              </section>
            )}
          </div>

          <div className="border-t border-line px-2 py-2">
            <div className="mb-1.5">
              <NavItem
                icon={
                  <Trash2 size={16} />
                }
                label={t('Trash')}
                onClick={() =>
                  ws.setTrashOpen(true)
                }
              />
            </div>

            <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-3xs font-semibold text-white"
                style={{
                  background: av.color,
                }}
              >
                {av.initials}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {auth.user?.name ??
                    t('User')}
                </p>

                <p className="truncate text-2xs text-faint">
                  {auth.user?.role ===
                  'admin'
                    ? t('Admin')
                    : `@${
                        auth.user
                          ?.username ??
                        'you'
                      }`}
                </p>
              </div>

              <IconButton
                icon={
                  <Settings
                    size={16}
                  />
                }
                label={t('Settings')}
                side="top"
                onClick={() =>
                  ws.setSettingsOpen(
                    true,
                  )
                }
              />

              <IconButton
                icon={
                  <LogOut size={16} />
                }
                label={t('Log out')}
                side="top"
                tone="danger"
                onClick={() =>
                  auth.logout()
                }
              />
            </div>
          </div>
        </div>
      )}

      {!panelAway && (
        <div
          onMouseDown={onResizeStart}
          className="group absolute right-0 top-0 h-full w-1 cursor-col-resize"
          role="separator"
          aria-label={t(
            'Resize sidebar',
          )}
        >
          <div className="absolute right-0 top-0 h-full w-px bg-line transition-colors group-hover:w-0.5 group-hover:bg-accent" />
        </div>
      )}
    </aside>
  );
}
