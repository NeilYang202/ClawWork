import type Database from 'better-sqlite3';

export interface SearchResult {
  type: 'task' | 'message' | 'artifact';
  id: string;
  title: string;
  snippet: string;
  taskId?: string;
}

const SEARCH_SQL = `
SELECT * FROM (
  SELECT 'task' AS type, t.id, t.title, snippet(tasks_fts, 0, '<<', '>>', '…', 32) AS snippet,
    NULL AS task_id, tasks_fts.rank
  FROM tasks_fts
  JOIN tasks t ON t.rowid = tasks_fts.rowid
  WHERE tasks_fts MATCH ?
  UNION ALL
  SELECT 'message' AS type, m.id, substr(m.content, 1, 60) AS title,
    snippet(messages_fts, 0, '<<', '>>', '…', 32) AS snippet,
    m.task_id, messages_fts.rank
  FROM messages_fts
  JOIN messages m ON m.rowid = messages_fts.rowid
  WHERE messages_fts MATCH ?
  UNION ALL
  SELECT 'artifact' AS type, a.id, a.name AS title,
    snippet(artifacts_fts, 0, '<<', '>>', '…', 32) AS snippet,
    a.task_id, artifacts_fts.rank
  FROM artifacts_fts
  JOIN artifacts a ON a.rowid = artifacts_fts.rowid
  WHERE artifacts_fts MATCH ?
) ORDER BY rank LIMIT 20;
`;

export function globalSearch(db: Database.Database, query: string): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const ftsQuery = q.replace(/[^\w\u4e00-\u9fff]/g, ' ').trim() + '*';
  if (ftsQuery === '*') return [];

  const stmt = db.prepare(SEARCH_SQL);
  const rows = stmt.all(ftsQuery, ftsQuery, ftsQuery) as Array<{
    type: 'task' | 'message' | 'artifact';
    id: string;
    title: string;
    snippet: string;
    task_id: string | null;
  }>;

  return rows.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    taskId: r.task_id ?? undefined,
  }));
}
