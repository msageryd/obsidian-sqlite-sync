const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class DatabaseHandler {
  constructor(pluginPath) {
    this.pluginPath = pluginPath;
    this.dbPath = path.join(this.pluginPath, 'alfred_sync.db');
    this.ensureVersion();
  }

  async executeSQLite(dbPath, commands, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [dbPath]);
      let output = '';

      const timer = setTimeout(() => {
        sqlite.kill(); // Force kill if it doesn't exit in time
        reject(new Error('SQLite process timed out'));
      }, timeout);

      sqlite.stdout.on('data', (data) => {
        output += data.toString();
      });

      sqlite.stderr.on('data', (data) => {
        reject(new Error(`SQLite error: ${data}`));
      });

      sqlite.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`SQLite process exited with code ${code}`));
        } else {
          resolve(output);
        }
      });

      sqlite.stdin.write(commands);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async initialize() {
    const dbPath = path.join(this.pluginPath, 'alfred_sync.db');

    // Drop the existing database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    // Create a new database
    this.dbProcess = spawn('sqlite3', [dbPath]);
    this.dbProcess.stdout.on('data', (data) => {
      console.log(`sqlite3 stdout: ${data}`);
    });
    this.dbProcess.stderr.on('data', (data) => {
      console.error(`sqlite3 stderr: ${data}`);
    });
    this.dbProcess.on('close', (code) => {
      console.log(`sqlite3 process exited with code ${code}`);
    });

    const createTablesSQL = `
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
    await this.executeSQL(createTablesSQL);
  }

  executeSQL(sql) {
    return new Promise((resolve, reject) => {
      this.dbProcess.stdin.write(sql + ';\n');
      this.dbProcess.stdin.write('.print "QUERY_COMPLETE"\n');

      let output = '';
      const dataHandler = (data) => {
        output += data.toString();
        if (output.includes('QUERY_COMPLETE')) {
          this.dbProcess.stdout.removeListener('data', dataHandler);
          resolve(output.replace('QUERY_COMPLETE', '').trim());
        }
      };

      this.dbProcess.stdout.on('data', dataHandler);
    });
  }

  async updateNote(fileInfo) {
    const updateNoteSQL = `
      INSERT OR REPLACE INTO note (path, title, title_lower, content_lower, created, last_modified)
      VALUES (
        '${this.escapeSQLString(fileInfo.path)}',
        '${this.escapeSQLString(fileInfo.title)}',
        '${this.escapeSQLString(fileInfo.title.toLowerCase())}',
        '${this.escapeSQLString(fileInfo.content)}',
        ${fileInfo.created},
        ${fileInfo.last_modified}
      )
    `;
    await this.executeSQL(updateNoteSQL);

    // Update note_tag relationships
    await this.updateNoteTags(fileInfo);

    // Update note_frontmatter relationships
    // await this.updateNoteFrontmatter(fileInfo);
  }

  async deleteNote(path) {
    const deleteNoteSQL = `DELETE FROM note WHERE path = '${this.escapeSQLString(
      path
    )}'`;
    await this.executeSQL(deleteNoteSQL);
    // note_tag and note_frontmatter entries will be automatically deleted due to ON DELETE CASCADE
  }

  async updateNoteTags(fileInfo) {
    const { path, tags } = fileInfo;

    tags = tags.map((tag) => {
      if (tag.startsWith('#')) {
        tag = tag.slice(1);
      }
      tag = this.escapeSQLString(tag);
      return tag;
    });

    const updateTagsSQL = dbSql.getUpdateTagsSQL(fileInfo, tags);
    await this.executeSQL(updateTagsSQL);

    // // Insert new note_tag entries
    // for (let tag of tags) {
    //   if (tag.startsWith('#')) {
    //     tag = tag.slice(1);
    //   }
    //   tag = this.escapeSQLString(tag);

    //   const insertNoteTagSQL = `
    //     INSERT INTO note_tag
    //     (note_path, tag_name, tag_name_lower)
    //     VALUES
    //     ('${this.escapeSQLString(path)}', '${tag}', '${tag.toLowerCase()}')
    //   `;
    //   await this.executeSQL(insertNoteTagSQL);
    // }
  }

  async updateNoteFrontmatter(fileInfo) {
    const { path, frontmatter } = fileInfo;
    // Remove existing note_frontmatter entries for this note
    const deleteNoteFrontmatterSQL = `
      DELETE FROM note_frontmatter 
      WHERE note_path = '${this.escapeSQLString(path)}'
    `;
    await this.executeSQL(deleteNoteFrontmatterSQL);

    // Insert new note_frontmatter entries
    for (const [key, value] of Object.entries(frontmatter)) {
      const stringifiedValue = JSON.stringify(value);
      const stringifiedValueLower = JSON.stringify(value).toLowerCase();
      const insertNoteFrontmatterSQL = `
        INSERT INTO note_frontmatter 
        (note_path, frontmatter_name, frontmatter_value, frontmatter_value_lower)
        VALUES (
          '${this.escapeSQLString(path)}', 
          '${this.escapeSQLString(key)}', 
          '${this.escapeSQLString(stringifiedValue)}', 
          '${this.escapeSQLString(stringifiedValueLower)}')
      `;
      await this.executeSQL(insertNoteFrontmatterSQL);
    }
  }

  async updateLastOpened(path) {
    const updateLastOpenedSQL = `
      UPDATE note
      SET last_opened = ${Date.now()}
      WHERE path = '${this.escapeSQLString(path)}'
    `;
    await this.executeSQL(updateLastOpenedSQL);
  }

  escapeSQLString(str) {
    return str.replace(/'/g, "''");
  }

  close() {
    if (this.dbProcess) {
      this.dbProcess.stdin.end();
    }
  }
}

module.exports = DatabaseHandler;
