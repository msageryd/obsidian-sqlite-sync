module.exports.CURRENT_VERSION = 20;
module.exports.MIN_MIGRATION_VERSION = 18;

module.exports.checkVersionTableExists = `
  SELECT name FROM sqlite_master WHERE type='table' AND name='version';
`;

module.exports.updateVersion = `
  CREATE TABLE IF NOT EXISTS version (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER
  );
  INSERT OR REPLACE INTO version (id, version) VALUES (1, ${module.exports.CURRENT_VERSION});
`;

module.exports.getVersion = `
  SELECT version FROM version WHERE id = 1;
`;

module.exports.createDatabase = `
    CREATE TABLE IF NOT EXISTS note (
    path TEXT PRIMARY KEY,
    title TEXT,
    title_lower TEXT,
    content_lower TEXT,
    created INTEGER,
    last_modified INTEGER,
    last_opened INTEGER
  );

  CREATE TABLE IF NOT EXISTS tag (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE IF NOT EXISTS note_tag (
    note_path TEXT,
    tag_name TEXT,
    tag_name_lower TEXT,
    PRIMARY KEY (note_path, tag_name_lower),
    FOREIGN KEY (note_path) REFERENCES note(path) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS note_frontmatter (
    note_path TEXT,
    frontmatter_name TEXT,
    frontmatter_name_lower TEXT,
    frontmatter_value TEXT,
    frontmatter_value_lower TEXT,
    PRIMARY KEY (note_path, frontmatter_name_lower),
    FOREIGN KEY (note_path) REFERENCES note(path) ON DELETE CASCADE
  );
`;

module.exports.migrate = {
  10: 'ALTER TABLE some_table ADD COLUMN new_column TEXT;',
  11: 'CREATE TABLE new_table (id INTEGER PRIMARY KEY, name TEXT);',
  12: 'ALTER TABLE new_table ADD COLUMN timestamp INTEGER;',
};
