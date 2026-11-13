import crypto from 'node:crypto';
import { buildDocState } from './blocks.js';
import { spaceForNew } from './space-move.js';

export const WORKFLOW_TEMPLATES = [
  { id: 'launch', name: 'Product launch', description: 'A launch brief, three milestones and private kickoff notes.', milestones: ['Approve launch brief', 'Complete readiness review', 'Launch and review results'], headings: ['Audience and problem', 'Success measures', 'Scope', 'Risks and decisions'] },
  { id: 'onboarding', name: 'Team onboarding', description: 'An onboarding brief, three milestones and private check-in notes.', milestones: ['Agree on onboarding goals', 'Complete first contribution', 'Review first month'], headings: ['Role and goals', 'People and resources', 'First contribution', 'Questions and support'] },
];
const validName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 120;

export async function createWorkflow(pool, { templateId, name, spaceId, userId }) {
  const template = WORKFLOW_TEMPLATES.find(t => t.id === templateId);
  if (!template) throw new Error('Unknown workflow');
  if (!validName(name)) throw new Error('Enter a name of 1–120 characters');
  name = name.trim();
  const label = name.replace(/[\[\]\\<>]/g, '').replace(/\s+/g, ' ');
  const projectId = crypto.randomUUID(), briefId = crypto.randomUUID(), notesId = crypto.randomUUID();
  const milestoneIds = template.milestones.map(() => crypto.randomUUID());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    spaceId = await spaceForNew(client, { requested: spaceId });
    const brief = `Project: [${label}](/db/${projectId})\n\n${template.headings.map(h => `## ${h}\n\n`).join('\n')}## Milestones\n${template.milestones.map((m, i) => `- [${m}](/db/${projectId}?task=${milestoneIds[i]})`).join('\n')}`;
    const notes = `Brief: [${label} — brief](/d/${briefId})\nProject: [${label}](/db/${projectId})\n\n## Agenda\n- Review goals and milestones\n\n## Notes\n\n## Decisions\n\n## Action items\n- [ ] `;
    for (const [id, title, visibility, body] of [[briefId, `${name} — brief`, 'team', brief], [notesId, `${name} — meeting notes`, 'private', notes]]) {
      await client.query('INSERT INTO docs (id, title, icon, created_by, visibility, kind, space_id, search_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [id, title, '📝', userId, visibility, 'doc', spaceId, body]);
      await client.query("INSERT INTO doc_access (doc_id, user_id, role) VALUES ($1,$2,'owner')", [id, userId]);
      await client.query('INSERT INTO doc_states (doc_id, state) VALUES ($1,$2)', [id, Buffer.from(buildDocState(title, body))]);
    }
    await client.query('INSERT INTO projects (id, name, doc_id, created_by, space_id) VALUES ($1,$2,$3,$4,$5)', [projectId, name, briefId, userId, spaceId]);
    for (let i = 0; i < template.milestones.length; i++) {
      await client.query("INSERT INTO tasks (id, project_id, title, status, milestone, position, created_by, updated_by) VALUES ($1,$2,$3,'todo',true,$4,$5,$5)", [milestoneIds[i], projectId, template.milestones[i], i, userId]);
    }
    await client.query('COMMIT');
    return { projectId, briefId, notesId, milestoneIds, spaceId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function registerWorkflowTemplateRoutes(app, { requireUser, needsPerson, wrap, pool }) {
  app.get('/api/workflow-templates', requireUser, wrap(async (_req, res) => res.json(WORKFLOW_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })))));
  app.post('/api/workflow-templates/:id/use', requireUser, needsPerson, wrap(async (req, res) => {
    if (!WORKFLOW_TEMPLATES.some(t => t.id === req.params.id)) return res.status(404).json({ error: 'Unknown workflow' });
    if (!validName(req.body?.name) || (req.body?.spaceId !== undefined && typeof req.body.spaceId !== 'string')) return res.status(400).json({ error: 'Enter a name of 1–120 characters and a valid space' });
    res.json(await createWorkflow(pool, { templateId: req.params.id, name: req.body.name, spaceId: req.body.spaceId, userId: req.user.id }));
  }));
}
