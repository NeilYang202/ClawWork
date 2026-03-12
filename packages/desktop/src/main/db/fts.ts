import type Database from 'better-sqlite3';

const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(name, tokenize='unicode61');

-- messages triggers
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

-- tasks triggers
CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE rowid = old.rowid;
  INSERT INTO tasks_fts(rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE rowid = old.rowid;
END;

-- artifacts triggers
CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, name) VALUES (new.rowid, new.name);
END;
CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
  DELETE FROM artifacts_fts WHERE rowid = old.rowid;
  INSERT INTO artifacts_fts(rowid, name) VALUES (new.rowid, new.name);
END;
CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
  DELETE FROM artifacts_fts WHERE rowid = old.rowid;
END;
`;

const BACKFILL_SQL = `
INSERT OR IGNORE INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;
INSERT OR IGNORE INTO tasks_fts(rowid, title) SELECT rowid, title FROM tasks;
INSERT OR IGNORE INTO artifacts_fts(rowid, name) SELECT rowid, name FROM artifacts;
`;

export function initFTS(db: Database.Database): void {
  db.exec(FTS_DDL);
  db.exec(BACKFILL_SQL);
  console.log('[fts] FTS5 virtual tables initialized');
}
