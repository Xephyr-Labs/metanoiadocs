// The MetanoiaDocs tool surface, shared by every MCP transport.
//
// Tools call the workspace's own REST API rather than the database, so a tool
// can never see more than the caller's token already grants: the same route,
// the same auth, the same visibility rules. The caller's credentials arrive as
// headers and are forwarded verbatim.
//
// `mcp/` still ships a standalone stdio server for people who want to run one
// locally; server/src/mcp-http.test.js asserts the two tool lists stay
// identical, so this file and that one cannot drift apart unnoticed.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DEFAULT_ZONE, dayIn } from './timezone.js';
import { REPEAT_RULES } from './repeat.js';

const ok = (obj) => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
});
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });

/**
 * @param {object} opts
 * @param {string} opts.base      Origin to call, no trailing slash (e.g. http://127.0.0.1:3000).
 * @param {Record<string,string>} opts.headers  Auth headers forwarded on every call.
 */
export function createMetanoiaMcpServer({ base, headers = {}, zone = DEFAULT_ZONE }) {
  const origin = String(base || '').replace(/\/+$/, '');

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${origin}/api${path}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  const server = new McpServer({ name: 'metanoiadocs', version: '1.0.0' });

  server.registerTool(
    'search_docs',
    {
      title: 'Search docs',
      description:
        'Full-text search across the docs you can access. Returns id, title, and a snippet for each match.',
      inputSchema: { query: z.string().describe('Search terms') },
    },
    async ({ query }) => {
      try {
        const rows = await api(`/search?q=${encodeURIComponent(query)}`);
        return ok(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            snippet: (r.snippet || '').replace(/<\/?b>/g, ''),
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_docs',
    {
      title: 'List docs',
      description: 'List the docs you can access (id, title, visibility, favorite, last updated).',
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await api('/docs');
        return ok(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            visibility: r.visibility,
            favorite: r.favorite,
            updated_at: r.updated_at,
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read a doc',
      description: "Get a doc's title and its plain-text content by id.",
      inputSchema: { id: z.string().describe('Document id') },
    },
    async ({ id }) => {
      try {
        return ok(await api(`/docs/${encodeURIComponent(id)}/text`));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'create_doc',
    {
      title: 'Create a doc',
      description:
        'Create a new document. `content` is markdown — headings (#), bullet/numbered lists, to-dos (- [ ]), quotes (>), fenced code (```), and dividers (---) become real editor blocks. Returns the new doc id.',
      inputSchema: {
        title: z.string().describe('Document title'),
        content: z.string().optional().describe('Markdown body (optional)'),
        visibility: z
          .enum(['team', 'private'])
          .optional()
          .describe('team (default) = whole workspace; private = only you'),
      },
    },
    async ({ title, content, visibility }) => {
      try {
        const doc = await api('/docs', { method: 'POST', body: { title, content, visibility } });
        return ok({ id: doc.id, title: doc.title, visibility: doc.visibility });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'write_doc',
    {
      title: 'Write to a doc',
      description:
        "Append or replace a doc's content with markdown. mode=append (default) adds to the end; mode=replace overwrites. Changes appear when the doc is next opened.",
      inputSchema: {
        id: z.string().describe('Document id'),
        markdown: z.string().describe('Markdown content'),
        mode: z.enum(['append', 'replace']).optional(),
      },
    },
    async ({ id, markdown, mode }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/content`, {
          method: 'POST',
          body: { markdown, mode },
        });
        return ok('Done.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'comment_on_doc',
    {
      title: 'Comment on a doc',
      description: 'Add a comment to a doc. Use @username to mention and notify a member.',
      inputSchema: {
        id: z.string().describe('Document id'),
        body: z.string().describe('Comment text'),
      },
    },
    async ({ id, body }) => {
      try {
        const r = await api(`/docs/${encodeURIComponent(id)}/comments`, {
          method: 'POST',
          body: { body },
        });
        return ok({ commentId: r.id });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'read_comments',
    {
      title: 'Read a doc\'s comments',
      description:
        'The comment threads on a doc, oldest first. Each row carries the author, the body, the quoted text it is anchored to, whether it is resolved, and `parentId` — null for a thread root, otherwise the comment it replies to. Reach for this whenever you are told you were mentioned on a doc: the notification only says which doc, so the request itself lives here.',
      inputSchema: {
        id: z.string().describe('Document id'),
        includeResolved: z
          .boolean()
          .optional()
          .describe('Include resolved threads too (default false — resolved means handled)'),
      },
    },
    async ({ id, includeResolved }) => {
      try {
        const rows = await api(`/docs/${encodeURIComponent(id)}/comments`);
        const kept = (rows || []).filter((c) => includeResolved || !c.resolved);
        return ok(
          kept.map((c) => ({
            id: c.id,
            author: c.author_name,
            body: c.body,
            quote: c.quote || null,
            parentId: c.parent_id,
            resolved: c.resolved,
            createdAt: c.created_at,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'set_visibility',
    {
      title: 'Set doc visibility',
      description: 'Set a doc to team (everyone) or private (only you). You must own the doc.',
      inputSchema: { id: z.string(), visibility: z.enum(['team', 'private']) },
    },
    async ({ id, visibility }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/visibility`, {
          method: 'PUT',
          body: { visibility },
        });
        return ok(`Set to ${visibility}.`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'add_tag',
    {
      title: 'Tag a doc',
      description: 'Attach a tag to a doc (creates the tag if it does not exist).',
      inputSchema: { id: z.string(), name: z.string().describe('Tag name') },
    },
    async ({ id, name }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/tags`, { method: 'POST', body: { name } });
        return ok(`Tagged with "${name}".`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_members',
    {
      title: 'List members',
      description:
        'List workspace members (name, username, email, role) — useful for @-mentions, and for the email share_doc needs.',
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await api('/users');
        return ok(
          rows.map((u) => ({ name: u.name, username: u.username, email: u.email, role: u.role }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_folders',
    {
      title: 'List folders',
      description:
        'List the workspace folders (id, name, parent, how many docs are in each). Use this to find the folder id that move_doc needs.',
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await api('/folders');
        return ok(
          rows.map((f) => ({
            id: f.id,
            name: f.name,
            parentId: f.parent_id,
            documents: f.document_count,
          }))
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'move_doc',
    {
      title: 'Move a doc to a folder',
      description:
        'Move a doc into a folder, or out to the top level. Get folder ids from list_folders.',
      inputSchema: {
        id: z.string().describe('Document id'),
        folderId: z
          .string()
          .nullable()
          .optional()
          .describe('Destination folder id; null or omitted moves it to the top level'),
      },
    },
    async ({ id, folderId }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { folderId: folderId ?? null },
        });
        return ok(folderId ? 'Moved.' : 'Moved to the top level.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'link_docs',
    {
      title: 'Nest one doc under another',
      description:
        "Link an existing doc under another one: a reference to the child is appended to the parent's body, and the child then appears nested under it in the sidebar. The parent must have been opened at least once.",
      inputSchema: {
        parentId: z.string().describe('The doc that gains the reference'),
        childId: z.string().describe('The doc to nest under it'),
      },
    },
    async ({ parentId, childId }) => {
      try {
        const r = await api(`/docs/${encodeURIComponent(parentId)}/links`, {
          method: 'POST',
          body: { childId },
        });
        return ok(r?.already ? 'Already linked.' : 'Linked.');
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'share_doc',
    {
      title: 'Share a doc with a teammate',
      description:
        'Grant a workspace member editor access to a doc by their email. You must own the doc, and they must have signed in at least once. Use list_members to find the email.',
      inputSchema: {
        id: z.string().describe('Document id'),
        email: z.string().describe("The member's email address"),
      },
    },
    async ({ id, email }) => {
      try {
        await api(`/docs/${encodeURIComponent(id)}/share`, { method: 'POST', body: { email } });
        return ok(`Shared with ${email}.`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  // Public origin, for links a person can click.
  const PUBLIC = process.env.BASE_URL || '';

  // ── the task board ────────────────────────────────────────────────────────
  // Boards ("projects") live in the same workspace as the documents, and a task
  // usually has a page behind it (`doc_id`) — which is why a task links to its
  // page when it has one and to the board when it does not.
  //
  // Everything here goes through the same REST routes the app uses, so a tool
  // can never reach further than the caller's own token already does.

  const STATUSES = ['todo', 'doing', 'review', 'done'];
  const SPRINT_STATES = ['planned', 'active', 'done'];
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const dayOf = (d) => d.toISOString().slice(0, 10);
  const dueDay = (t) => (t.due_at ? String(t.due_at).slice(0, 10) : null);

  // A task due today is NOT overdue. That is how the board counts it
  // (`due_at < current_date`), and a tool that disagreed with the page it links
  // to would turn every number into an argument.
  const isOverdue = (t, today) => {
    const d = dueDay(t);
    return d !== null && d < today;
  };
  const isDueWithin = (t, days, today) => {
    const d = dueDay(t);
    if (d === null) return false;
    const edge = new Date(`${today}T00:00:00Z`);
    edge.setUTCDate(edge.getUTCDate() + days);
    return d <= dayOf(edge);
  };

  const checkDate = (label, value) => {
    if (value && !DATE.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got "${value}"`);
  };

  const taskUrl = (t) => (t.doc_id ? `${PUBLIC}/d/${t.doc_id}` : `${PUBLIC}/db/${t.project_id}`);

  const taskRow = (t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    kind: t.kind,
    project: t.project_name,
    assignees: (t.assignees || []).map((a) => a.name).filter(Boolean),
    due: dueDay(t),
    kind: t.kind,
    docId: t.doc_id,
    tags: t.tags || [],
    points: t.points,
    estimateH: t.estimate_h ?? null,
    repeats: t.repeat_rule ?? null,
    sprintId: t.sprint_id,
    blockedBy: t.deps || [],
    url: taskUrl(t),
  });

  /**
   * Find a member by whatever the caller had to hand — id, email, username or
   * name. An ambiguous match is an error rather than a guess: assigning work to
   * the wrong person is worse than asking again.
   */
  function findPerson(all, who) {
    const q = String(who).trim().toLowerCase();
    const exact = all.find(
      (u) => u.id === who || (u.email || '').toLowerCase() === q || (u.username || '').toLowerCase() === q,
    );
    if (exact) return exact;
    const named = all.filter((u) => (u.name || '').toLowerCase().includes(q));
    if (named.length === 1) return named[0];
    if (named.length > 1) {
      throw new Error(`"${who}" matches ${named.map((u) => u.email).join(', ')} — use one of those emails.`);
    }
    throw new Error(`No workspace member matches "${who}". Use list_members to see them.`);
  }

  function pickBoard(all, which) {
    const q = String(which).trim().toLowerCase();
    const byId = all.find((p) => p.id === which);
    if (byId) return byId;
    const named = all.filter((p) => (p.name || '').toLowerCase().includes(q));
    if (named.length === 1) return named[0];
    if (named.length > 1) throw new Error(`"${which}" matches ${named.map((p) => p.name).join(', ')}.`);
    throw new Error(`No board called "${which}". Known boards: ${all.map((p) => p.name).join(', ')}.`);
  }

  /**
   * The board, refusing the one kind that cannot hold work.
   *
   * Archived boards need no check here: /api/projects leaves them out, so
   * findBoard cannot return one in the first place.
   */
  function workBoard(project) {
    if (project.mode === 'data') {
      throw new Error(`"${project.name}" is a data table, not a work board — a task there would never appear in list_tasks.`);
    }
    return project;
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const findBoard = async (which) => pickBoard(await api('/projects'), which);

  /**
   * Task types are per board. An unknown one is silently replaced with 'task' by
   * the server, so a bug filed with a typo would quietly become an ordinary task
   * and nobody would know to look for it.
   */
  async function checkKind(board, kind) {
    const kinds = await api(`/projects/${encodeURIComponent(board.id)}/kinds`);
    if (!kinds.some((k) => k.key === kind)) {
      throw new Error(`"${board.name}" has no task type "${kind}". It has: ${kinds.map((k) => k.key).join(', ')}.`);
    }
  }

  /**
   * A task carries its detail on a page of its own, not in a description column.
   * The page is created on demand and hidden from the sidebar — it belongs to
   * the row and is reached through it.
   */
  async function writeTaskPage(task, markdown) {
    const { docId } = await api(`/tasks/${encodeURIComponent(task.id)}/page`, { method: 'POST' });
    await api(`/docs/${encodeURIComponent(docId)}/content`, {
      method: 'POST',
      body: { markdown, mode: 'replace' },
    });
    return docId;
  }

  /** Resolve people-ish strings to ids, for assigning a task. */
  async function assigneeIds(who) {
    if (who === undefined) return undefined;
    const all = await api('/users');
    return who.map((w) => findPerson(all, w).id);
  }

  server.registerTool(
    'list_boards',
    {
      title: 'List task boards',
      description:
        'The task boards, with how many tasks each holds, how many are done and how many are overdue. Archived boards are left out. Every task tool accepts a board by name, so this is mostly for "what boards are there".',
      inputSchema: {},
    },
    async () => {
      try {
        // The route already leaves archived boards out.
        const rows = await api('/projects');
        return ok(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            mode: p.mode,
            tasks: p.total,
            done: p.done,
            overdue: p.overdue,
            url: `${PUBLIC}/db/${p.id}`,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_board',
    {
      title: 'Create a task board',
      description:
        'Create a board. mode=tasks (default) is a board of work; mode=data is a plain table of rows and never appears in list_tasks.',
      inputSchema: {
        name: z.string(),
        icon: z.string().optional().describe('A single emoji; defaults to 📋'),
        mode: z.enum(['tasks', 'data']).optional(),
      },
    },
    async ({ name, icon, mode }) => {
      try {
        const p = await api('/projects', { method: 'POST', body: { name, icon, mode } });
        return ok({ id: p.id, name: p.name, mode: p.mode, url: `${PUBLIC}/db/${p.id}` });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'archive_board',
    {
      title: 'Archive or restore a board',
      description:
        'Archive a board, or bring one back. Archiving hides it and its work without deleting anything — there is no hard delete for a board. Archiving takes a name or an id; RESTORING takes the id, because an archived board is not listed anywhere to be found by name. Its id is the last part of its /db/<id> address.',
      inputSchema: {
        board: z.string().describe('Board name or id — an id is required to restore'),
        archived: z.boolean().optional().describe('Default true; false restores it'),
      },
    },
    async ({ board, archived }) => {
      try {
        // /api/projects returns only live boards, so an archived one cannot be
        // looked up by name at all — a bare id is passed straight through.
        const found = UUID.test(board) ? null : pickBoard(await api('/projects'), board);
        const id = found ? found.id : board;
        await api(`/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { archived: archived !== false },
        });
        const label = found ? `"${found.name}"` : id;
        return ok(archived === false ? `Restored ${label}.` : `Archived ${label}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        "The team's work. Every filter is optional and they combine; by default you get everything that is not done, earliest deadline first. `assignee` takes a name, username or email (or \"unassigned\"); `board` takes a board name or id. Each row carries the id that update_task needs.",
      inputSchema: {
        assignee: z.string().optional().describe('Name, username or email — or "unassigned"'),
        board: z.string().optional().describe('Board name or id'),
        status: z.enum(STATUSES).optional(),
        includeDone: z.boolean().optional().describe('Default false — done work is left out'),
        overdue: z.boolean().optional().describe('Only tasks whose due date has passed'),
        dueWithinDays: z.number().optional().describe('Only tasks due within this many days; late ones count'),
        search: z.string().optional().describe('Match against the title'),
        tag: z.string().optional().describe("Only tasks carrying this tag — a task's tags are the tags on its page"),
        limit: z.number().optional().describe('Default 50'),
      },
    },
    async ({ assignee, board, status, includeDone, overdue, dueWithinDays, search, tag, limit }) => {
      try {
        // The query parameters this route documents are unreachable — a second
        // handler for GET /api/tasks is registered ahead of them and answers
        // first — so the filtering happens here. That route also caps at 1000
        // rows, which is the real ceiling on this approach.
        const { tasks } = await api('/tasks');
        let rows = tasks;

        if (assignee) {
          if (assignee.trim().toLowerCase() === 'unassigned') {
            rows = rows.filter((t) => !(t.assignees || []).length);
          } else {
            const who = findPerson(await api('/users'), assignee);
            rows = rows.filter((t) => (t.assignees || []).some((a) => a.id === who.id));
          }
        }
        if (board) {
          const found = await findBoard(board);
          rows = rows.filter((t) => t.project_id === found.id);
        }
        if (status) rows = rows.filter((t) => t.status === status);
        else if (!includeDone) rows = rows.filter((t) => t.status !== 'done');

        if (search) {
          const q = search.toLowerCase();
          rows = rows.filter((t) => (t.title || '').toLowerCase().includes(q));
        }
        if (tag) {
          const q = tag.toLowerCase();
          rows = rows.filter((t) => (t.tags || []).some((x) => String(x).toLowerCase() === q));
        }

        // The caller's today, not the server's: "overdue" is a claim about
        // somebody's calendar, and a tool that answers from the container's
        // zone disagrees with the board the answer links to.
        const today = dayIn(zone);
        if (dueWithinDays !== undefined) rows = rows.filter((t) => isDueWithin(t, dueWithinDays, today));
        if (overdue) rows = rows.filter((t) => isOverdue(t, today));

        rows = [...rows].sort((a, b) => (dueDay(a) || '9999').localeCompare(dueDay(b) || '9999'));
        return ok({ count: rows.length, tasks: rows.slice(0, limit ?? 50).map(taskRow) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create a task',
      description:
        'Add a task to a board. `board` is a board name or id; `assignees` are names, usernames or emails, and everyone named is notified. Dates are YYYY-MM-DD. To tag it, call add_tag with the `docId` this returns — a task carries the tags of its own page rather than a second set of its own, and list_tasks can then filter on `tag`.',
      inputSchema: {
        board: z.string().describe('Board name or id'),
        title: z.string(),
        assignees: z.array(z.string()).optional().describe('Names, usernames or emails'),
        status: z.enum(STATUSES).optional().describe('Default todo'),
        dueAt: z.string().optional().describe('YYYY-MM-DD'),
        startAt: z.string().optional().describe('YYYY-MM-DD'),
        points: z.number().optional(),
        estimateH: z.number().optional().describe('Hours of work, to one decimal. Points size a sprint; this sizes a week'),
        repeatRule: z.enum(REPEAT_RULES).optional().describe('Finishing it creates the next occurrence'),
        priority: z.number().optional(),
        milestone: z.boolean().optional(),
        kind: z.string().optional().describe("Task type — 'task' (default), 'bug', 'story', 'epic'; see list_task_kinds"),
        body: z.string().optional().describe('Markdown written onto the task\'s own page — where the detail goes, since a task has no description field'),
        sprintId: z.string().optional().describe('From list_sprints; must be a sprint on this board'),
        docId: z.string().optional().describe('Write the task on an existing page instead of a new one'),
      },
    },
    async (args) => {
      try {
        checkDate('dueAt', args.dueAt);
        checkDate('startAt', args.startAt);
        const board = workBoard(await findBoard(args.board));
        if (args.kind) await checkKind(board, args.kind);
        const created = await api('/tasks', {
          method: 'POST',
          body: {
            projectId: board.id,
            title: args.title,
            status: args.status,
            dueAt: args.dueAt,
            startAt: args.startAt,
            points: args.points,
            estimateH: args.estimateH,
            repeatRule: args.repeatRule,
            priority: args.priority,
            milestone: args.milestone,
            kind: args.kind,
            sprintId: args.sprintId,
            docId: args.docId,
            assigneeIds: await assigneeIds(args.assignees),
          },
        });
        const docId = args.body ? await writeTaskPage(created, args.body) : created.doc_id;
        return ok({ ...taskRow(created), docId, board: board.name });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update a task',
      description:
        'Change a task: move it between todo/doing/review/done, retitle it, reassign it, set or clear a date, record progress, move it into a sprint. Only the fields you pass change. Pass assignees: [] to unassign everyone, dueAt: null to clear the date, sprintId: null to send it back to the backlog.',
      inputSchema: {
        id: z.string().describe('Task id from list_tasks'),
        title: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        assignees: z.array(z.string()).optional().describe('Replaces the current set; [] unassigns'),
        dueAt: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear'),
        startAt: z.string().nullable().optional().describe('YYYY-MM-DD, or null to clear'),
        progress: z.number().optional().describe('0-100'),
        points: z.number().nullable().optional(),
        estimateH: z.number().nullable().optional().describe('Hours of work; null clears it'),
        repeatRule: z.enum(REPEAT_RULES).nullable().optional().describe('null stops it repeating'),
        priority: z.number().optional(),
        milestone: z.boolean().optional(),
        kind: z.string().optional().describe("Task type — 'task', 'bug', 'story', 'epic'; see list_task_kinds"),
        sprintId: z.string().nullable().optional().describe('null returns it to the backlog'),
      },
    },
    async (args) => {
      try {
        checkDate('dueAt', args.dueAt);
        checkDate('startAt', args.startAt);
        // Only send what was asked for: the route treats an absent key as "leave
        // it alone" and a null as "clear it".
        const body = {};
        for (const key of ['title', 'status', 'dueAt', 'startAt', 'progress', 'points', 'estimateH', 'repeatRule', 'priority', 'milestone', 'kind', 'sprintId']) {
          if (args[key] !== undefined) body[key] = args[key];
        }
        if (args.assignees !== undefined) body.assigneeIds = await assigneeIds(args.assignees);
        if (!Object.keys(body).length) throw new Error('Nothing to change — pass at least one field.');
        return ok(taskRow(await api(`/tasks/${encodeURIComponent(args.id)}`, { method: 'PATCH', body })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete a task',
      description:
        "Move a task to the trash, along with the page it was written on. It is recoverable from the workspace's trash, but this tool cannot bring it back — say what you are deleting before you do.",
      inputSchema: { id: z.string().describe('Task id from list_tasks') },
    },
    async ({ id }) => {
      try {
        await api(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return ok('Moved to the trash.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_task_kinds',
    {
      title: "List a board's task types",
      description:
        "The task types a board accepts — task, bug, story, epic by default, but they are per board and can be renamed or added to. These are the keys create_task and update_task take as `kind`.",
      inputSchema: { board: z.string().describe('Board name or id') },
    },
    async ({ board }) => {
      try {
        const found = await findBoard(board);
        const kinds = await api(`/projects/${encodeURIComponent(found.id)}/kinds`);
        return ok(kinds.map((k) => ({ key: k.key, label: k.label, isGroup: k.is_group })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_sprints',
    {
      title: "List a board's sprints",
      description:
        'The sprints on a board, newest state first, each with its task and point totals. A sprint is planned, active or done; a board has at most one active sprint.',
      inputSchema: { board: z.string().describe('Board name or id') },
    },
    async ({ board }) => {
      try {
        const found = await findBoard(board);
        const rows = await api(`/projects/${encodeURIComponent(found.id)}/sprints`);
        return ok(
          rows.map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
            start: s.start_at ? String(s.start_at).slice(0, 10) : null,
            end: s.end_at ? String(s.end_at).slice(0, 10) : null,
            tasks: s.total,
            done: s.done,
            points: s.points,
            pointsDone: s.points_done,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_sprint',
    {
      title: 'Create a sprint',
      description: 'Add a sprint to a board. It starts in the planned state; use update_sprint to begin it.',
      inputSchema: {
        board: z.string().describe('Board name or id'),
        name: z.string(),
        startAt: z.string().optional().describe('YYYY-MM-DD'),
        endAt: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    async ({ board, name, startAt, endAt }) => {
      try {
        checkDate('startAt', startAt);
        checkDate('endAt', endAt);
        const found = workBoard(await findBoard(board));
        const s = await api(`/projects/${encodeURIComponent(found.id)}/sprints`, {
          method: 'POST',
          body: { name, startAt, endAt },
        });
        return ok({ id: s.id, name: s.name, state: s.state, board: found.name });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_sprint',
    {
      title: 'Update a sprint',
      description:
        "Rename a sprint, move its dates, or change its state. Starting one (state: active) parks whichever sprint on that board was active. Completing one (state: done) returns its unfinished work to the backlog — that is the app's behaviour, not this tool's, and it cannot be undone by setting the state back.",
      inputSchema: {
        id: z.string().describe('Sprint id from list_sprints'),
        name: z.string().optional(),
        startAt: z.string().optional().describe('YYYY-MM-DD'),
        endAt: z.string().optional().describe('YYYY-MM-DD'),
        state: z.enum(SPRINT_STATES).optional(),
      },
    },
    async ({ id, name, startAt, endAt, state }) => {
      try {
        checkDate('startAt', startAt);
        checkDate('endAt', endAt);
        const body = {};
        if (name !== undefined) body.name = name;
        if (startAt !== undefined) body.startAt = startAt;
        if (endAt !== undefined) body.endAt = endAt;
        if (state !== undefined) body.state = state;
        if (!Object.keys(body).length) throw new Error('Nothing to change — pass at least one field.');
        const s = await api(`/sprints/${encodeURIComponent(id)}`, { method: 'PATCH', body });
        return ok({ id: s.id, name: s.name, state: s.state });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'delete_sprint',
    {
      title: 'Delete a sprint',
      description:
        'Remove a sprint. Its tasks are not deleted — they return to the backlog. Unlike a task, a sprint does not go to the trash, so this one is final.',
      inputSchema: { id: z.string().describe('Sprint id from list_sprints') },
    },
    async ({ id }) => {
      try {
        await api(`/sprints/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return ok('Deleted; its tasks went back to the backlog.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'add_task_dependency',
    {
      title: 'Make one task wait for another',
      description:
        'Record that a task is blocked by another one. A dependency that would close a loop is refused by the server. Both ids come from list_tasks.',
      inputSchema: {
        id: z.string().describe('The task that waits'),
        dependsOn: z.string().describe('The task it waits for'),
      },
    },
    async ({ id, dependsOn }) => {
      try {
        await api(`/tasks/${encodeURIComponent(id)}/deps`, { method: 'POST', body: { dependsOn } });
        return ok('Linked.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'remove_task_dependency',
    {
      title: 'Remove a dependency',
      description: 'Drop the link that made one task wait for another.',
      inputSchema: {
        id: z.string().describe('The task that was waiting'),
        dependsOn: z.string().describe('The task it was waiting for'),
      },
    },
    async ({ id, dependsOn }) => {
      try {
        await api(`/tasks/${encodeURIComponent(id)}/deps/${encodeURIComponent(dependsOn)}`, { method: 'DELETE' });
        return ok('Unlinked.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'workspace_overview',
    {
      title: 'Workspace overview',
      description:
        "The home dashboard as data: counts across the workspace, the caller's own tasks bucketed by urgency, recently touched documents, recent activity and the boards. One call when the question is \"what is going on\" rather than a specific lookup.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await api('/home'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

/** Tool names this server registers, in registration order. Used by the drift test. */
export const MCP_TOOL_NAMES = [
  'search_docs',
  'list_docs',
  'read_doc',
  'create_doc',
  'write_doc',
  'comment_on_doc',
  'read_comments',
  'set_visibility',
  'add_tag',
  'list_members',
  'list_folders',
  'move_doc',
  'link_docs',
  'share_doc',
  'list_boards',
  'create_board',
  'archive_board',
  'list_tasks',
  'create_task',
  'update_task',
  'delete_task',
  'list_task_kinds',
  'list_sprints',
  'create_sprint',
  'update_sprint',
  'delete_sprint',
  'add_task_dependency',
  'remove_task_dependency',
  'workspace_overview',
];
