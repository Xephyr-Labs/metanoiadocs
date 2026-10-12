-- Everything the seed made happened "just now". Spread it over the last month,
-- so the activity feed, the inbox and "Edited …" read like a team at work.
-- Content dates (start/due) are already right; only bookkeeping times move.
\set maya '(SELECT id FROM users WHERE username = ''maya'')'

UPDATE docs SET created_at = now() - interval '30 days';
UPDATE tasks SET created_at = now() - interval '4 days' - (num * interval '7 minutes'),
                 updated_at = now() - interval '4 days',
                 done_at = CASE WHEN done_at IS NULL THEN NULL ELSE now() - interval '3 days' - (num * interval '1 hour') END;
-- The agent's tasks are the latest, so its mark shows near the top of the feed.
UPDATE tasks SET created_at = now() - interval '3 days' - (num * interval '7 minutes')
 WHERE created_by = (SELECT id FROM users WHERE username = 'ravi');
-- A task's page carries the task's dates, or it would count as a fresh edit.
UPDATE docs d SET created_at = t.created_at, updated_at = t.created_at
  FROM tasks t WHERE t.doc_id = d.id;

UPDATE docs SET updated_by = :maya, updated_via = 'human', updated_at = now() - x.ago
  FROM (VALUES ('Launch plan%', interval '6 minutes'), ('Q4 roadmap', interval '2 hours'),
               ('Onboarding%', interval '5 hours'), ('Design principles', interval '2 days'),
               ('Incident review%', interval '9 days'), ('Weekly sync%', interval '6 days')) AS x(t, ago)
 WHERE docs.title LIKE x.t AND docs.kind = 'doc';
-- One edit made with Ask AI, so the feed shows the copilot mark.
UPDATE docs SET updated_via = 'ai' WHERE title = 'Design principles';

UPDATE comments SET created_at = now() - interval '4 days' + (x.n * interval '25 minutes')
  FROM (SELECT id, row_number() OVER (ORDER BY created_at) AS n FROM comments) x WHERE x.id = comments.id;
UPDATE notifications n SET created_at = c.created_at FROM comments c WHERE c.id = n.comment_id;
UPDATE notifications SET created_at = now() - interval '4 days' WHERE comment_id IS NULL;
