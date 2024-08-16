const { escapeSQLString, cleanTextForSearch } = require('./util');
module.exports.CURRENT_VERSION = 20;
module.exports.MIN_MIGRATION_VERSION = 18;

// Update tags ----------------------------------------------------------------
module.exports.getUpdateTagsSql = (fileInfoArray) => {
  if (!Array.isArray(fileInfoArray)) {
    fileInfoArray = [fileInfoArray];
  }
  const allPaths = fileInfoArray
    .map((fileInfo) => `'${escapeSQLString(fileInfo.path)}'`)
    .join(',');

  const tags = fileInfoArray
    .map((fileInfo) => {
      return fileInfo.tags.map((tag) => {
        if (tag.startsWith('#')) {
          tag = tag.slice(1);
        }
        path = escapeSQLString(fileInfo.path);
        tag = escapeSQLString(tag);
        return `('${path}', '${tag}', '${tag.toLowerCase()}')`;
      });
    })
    .flat();

  const insertSQL =
    tags.length > 0
      ? `
          INSERT OR IGNORE INTO note_tag 
          (note_path, tag_name, tag_name_lower) 
          VALUES 
          ${tags.join(',\n')} ;
        `
      : '';

  return `
    DELETE FROM note_tag 
    WHERE note_path IN (${allPaths}); 

    ${insertSQL}
  `;
};

// Update notes ---------------------------------------------------------------
module.exports.getUpdateNoteSql = (fileInfoArray) => {
  if (!Array.isArray(fileInfoArray)) {
    fileInfoArray = [fileInfoArray];
  }

  const values = fileInfoArray.map((fileInfo) => {
    const path = escapeSQLString(fileInfo.path);
    const title = escapeSQLString(fileInfo.title);
    const titleLower = escapeSQLString(fileInfo.title.toLowerCase());
    const contentLower = cleanTextForSearch(fileInfo.content);
    return `('${path}', '${title}', '${titleLower}', '${contentLower}', ${fileInfo.created}, ${fileInfo.last_modified})`;
  });

  return `
    INSERT OR REPLACE INTO note (path, title, title_lower, content_lower, created, last_modified)
    VALUES 
    ${values.join(',\n')};
  `;
};

// Update frontMatter ---------------------------------------------------------------
module.exports.getUpdateFrontmatterSql = (fileInfoArray) => {
  if (!Array.isArray(fileInfoArray)) {
    fileInfoArray = [fileInfoArray];
  }
  const allPaths = fileInfoArray
    .map((fileInfo) => `'${escapeSQLString(fileInfo.path)}'`)
    .join(',');

  const frontmatter = fileInfoArray
    .map((fileInfo) => {
      return Object.entries(fileInfo.frontmatter).map(([key, value]) => {
        const stringifiedValue = escapeSQLString(JSON.stringify(value));
        const stringifiedValueLower = escapeSQLString(
          JSON.stringify(value).toLowerCase()
        );
        const notePath = escapeSQLString(fileInfo.path);
        const frontmatterName = escapeSQLString(key);

        return `('${notePath}', '${frontmatterName}', '${stringifiedValue}', '${stringifiedValueLower}')`;
      });
    })
    .flat();

  const insertSQL =
    frontmatter.length > 0
      ? `
        INSERT OR IGNORE INTO note_frontmatter 
        (note_path, frontmatter_name, frontmatter_value, frontmatter_value_lower)
        VALUES
        ${frontmatter.join(',\n')};
    `
      : '';

  return `
    DELETE FROM note_frontmatter
    WHERE note_path IN (${allPaths}); 

    ${insertSQL}
  `;
};

module.exports.getDeleteNoteSql = (path) =>
  `DELETE FROM note WHERE path = '${escapeSQLString(path)}';`;

// Update last_opened ---------------------------------------------------------------
module.exports.getUpdateLastOpenedSql = (path) => `
  UPDATE note
  SET last_opened = ${Date.now()}
  WHERE path = '${escapeSQLString(path)}';
`;

// =============================================================================
// DB Structure
// =============================================================================
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
  CREATE TABLE note (
    path TEXT PRIMARY KEY,
    title TEXT,
    title_lower TEXT,
    content_lower TEXT,
    created INTEGER,
    last_modified INTEGER,
    last_opened INTEGER
  );

  CREATE TABLE tag (
    name TEXT PRIMARY KEY
  );

  CREATE TABLE note_tag (
    note_path TEXT,
    tag_name TEXT,
    tag_name_lower TEXT,
    PRIMARY KEY (note_path, tag_name_lower),
    FOREIGN KEY (note_path) REFERENCES note(path) ON DELETE CASCADE
  );

  CREATE TABLE note_frontmatter (
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
  20: 'ALTER TABLE note ADD COLUMN timestamp INTEGER;',
};
