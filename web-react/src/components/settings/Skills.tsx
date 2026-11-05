/* Workspace skills: named, reusable instructions. Attached to agents, or
 * called from Ask AI as /name. Anyone may add one; its author or an admin
 * changes it, because its text runs inside other people's agents.
 * states: loading · empty · editing · confirming delete
 */
import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Plus, Wand2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { docsApi, type SkillRow } from '../../lib/docsApi';
import { toast } from '../../lib/toast';
import { useAuth } from '../../store/auth';
import { Button } from '../ui/Button';
import { field } from '../ui/styles';

function SkillEditor({ skill, mayEdit, onChanged }: { skill: SkillRow; mayEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: skill.name, description: skill.description, body: skill.body });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await docsApi.patchSkill(skill.id, draft);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the skill.');
    } finally { setSaving(false); }
  };

  return (
    <div className="py-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2.5 text-left">
        <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform duration-120', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-medium text-ink">/{skill.name}</span>
          <span className="block truncate text-xs text-faint">
            {skill.description || 'No description'}{skill.author_name ? ` · by ${skill.author_name}` : ''}
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 pl-[26px]">
          <input value={draft.name} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={cn(field, 'w-full font-mono')} aria-label="Skill name" />
          <input value={draft.description} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What it is for, in a line" className={cn(field, 'w-full')} aria-label="Description" />
          <textarea
            value={draft.body}
            disabled={!mayEdit}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={8}
            placeholder="The instructions: a checklist, a house style, a format to follow."
            className={cn(field, 'h-auto w-full py-2 leading-relaxed')}
            aria-label="Instructions"
          />
          {error && <p className="text-xs text-danger-strong">{error}</p>}
          {mayEdit ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" disabled={saving} onClick={save} leftIcon={saving ? <Loader2 size={14} className="animate-spin" /> : undefined}>Save</Button>
              {confirming ? (
                <>
                  <button onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink">Cancel</button>
                  <button onClick={async () => { await docsApi.deleteSkill(skill.id).catch((e) => toast(e.message)); onChanged(); }} className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95">Delete</button>
                </>
              ) : (
                <button onClick={() => setConfirming(true)} className="ml-auto rounded-md px-2 py-1 text-xs text-danger-strong transition-colors duration-120 hover:bg-danger-soft">Delete</button>
              )}
            </div>
          ) : (
            <p className="text-2xs text-faint">Only its author or an admin can change this skill.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function Skills() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SkillRow[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => docsApi.skills().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await docsApi.createSkill({ name: name.trim(), description: '', body: '' });
      setName('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create that skill');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-ink">Skills</h2>
      <p className="mb-5 text-sm text-muted">
        Reusable instructions for the whole workspace. Attach one to an agent, or start an Ask AI message
        with <code className="font-mono">/name</code> to use it there.
      </p>
      <div className="border-b border-line pb-3">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="spec-review" className={cn(field, 'flex-1 font-mono')} aria-label="New skill name" />
          <Button variant="primary" size="sm" onClick={create} disabled={busy} leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>Add</Button>
        </div>
      </div>
      <div className="divide-y divide-line">
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-faint" /></div>
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-faint"><Wand2 size={20} className="opacity-60" />No skills yet.</p>
        ) : rows.map((s) => (
          <SkillEditor key={s.id} skill={s} mayEdit={s.created_by === user?.id || user?.role === 'admin'} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
