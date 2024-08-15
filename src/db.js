const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class SQLiteExecutor {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.CURRENT_VERSION = 12; // Update this as your schema evolves
    this.MIN_MIGRATION_VERSION = 9; // Minimum version that can be migrated
    this.isInitialized = false;
  }

  static async create(dbPath) {
    const executor = new SQLiteExecutor(dbPath);
    await executor.initialize();
    return executor;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      const initResult = await this.initializeDatabase();
      console.log(initResult.message);
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error; // Re-throw to allow caller to handle
    }
  }

  async initializeDatabase() {
    try {
      const dbExists = fs.existsSync(this.dbPath);
      if (!dbExists) {
        await this.createNewDatabase();
        return { status: 'created', message: 'New database created.' };
      }

      const versionTableExists = await this.checkVersionTableExists();
      if (!versionTableExists) {
        await this.createNewDatabase();
        return {
          status: 'reset',
          message: 'Database was reset to the latest version.',
        };
      }

      const currentVersion = await this.getCurrentVersion();
      if (currentVersion < this.MIN_MIGRATION_VERSION) {
        await this.createNewDatabase();
        return {
          status: 'reset',
          message: 'Database was reset to the latest version.',
        };
      } else if (currentVersion < this.CURRENT_VERSION) {
        await this.upgradeDatabase(currentVersion);
        return {
          status: 'upgraded',
          message: `Database upgraded from version ${currentVersion} to ${this.CURRENT_VERSION}.`,
        };
      } else {
        return { status: 'current', message: 'Database is up to date.' };
      }
    } catch (error) {
      console.error('Error during database initialization:', error);
      throw error;
    }
  }

  async checkVersionTableExists() {
    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [this.dbPath]);
      let output = '';

      sqlite.stdout.on('data', (data) => (output += data.toString()));
      sqlite.stderr.on('data', (data) =>
        reject(new Error(`SQLite error: ${data}`))
      );

      sqlite.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`SQLite process exited with code ${code}`));
        } else {
          resolve(output.trim() === 'version');
        }
      });

      sqlite.stdin.write(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='version';"
      );
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async getCurrentVersion() {
    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [this.dbPath]);
      let output = '';

      sqlite.stdout.on('data', (data) => (output += data.toString()));
      sqlite.stderr.on('data', (data) =>
        reject(new Error(`SQLite error: ${data}`))
      );

      sqlite.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`SQLite process exited with code ${code}`));
        } else {
          const version = parseInt(output.trim(), 10);
          resolve(isNaN(version) ? 0 : version);
        }
      });

      sqlite.stdin.write('SELECT version FROM version LIMIT 1;');
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async createNewDatabase() {
    return new Promise((resolve, reject) => {
      if (fs.existsSync(this.dbPath)) {
        fs.unlinkSync(this.dbPath);
      }

      const sqlite = spawn('sqlite3', [this.dbPath]);

      sqlite.stderr.on('data', (data) =>
        reject(new Error(`SQLite error: ${data}`))
      );

      sqlite.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`SQLite process exited with code ${code}`));
        } else {
          resolve();
        }
      });

      sqlite.stdin.write(`
        CREATE TABLE version (version INTEGER PRIMARY KEY);
        INSERT INTO version (version) VALUES (${this.CURRENT_VERSION});

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

      `);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async upgradeDatabase(fromVersion) {
    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [this.dbPath]);

      sqlite.stderr.on('data', (data) =>
        reject(new Error(`SQLite error: ${data}`))
      );

      sqlite.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`SQLite process exited with code ${code}`));
        } else {
          resolve();
        }
      });

      for (let v = fromVersion + 1; v <= this.CURRENT_VERSION; v++) {
        if (this.migrationScripts[v]) {
          sqlite.stdin.write(this.migrationScripts[v] + '\n');
        }
      }
      sqlite.stdin.write(
        `UPDATE version SET version = ${this.CURRENT_VERSION};\n`
      );
      sqlite.stdin.write('.exit\n');
      sqlite.stdin.end();
    });
  }

  async execute(commands, options = { json: false }) {
    if (!this.isInitialized) {
      throw new Error(
        'SQLiteExecutor not initialized. Call initialize() first.'
      );
    }

    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [
        this.dbPath,
        options.json ? '-json' : '',
      ]);
      let output = '';
      let errorOutput = '';

      sqlite.stdout.on('data', (data) => (output += data.toString()));
      sqlite.stderr.on('data', (data) => (errorOutput += data.toString()));

      sqlite.on('close', (code) => {
        console.log(code);
        console.log(errorOutput);
        console.log(output);
        if (code !== 0 || errorOutput.includes('not a database')) {
          reject(new Error(`SQLite error: ${errorOutput}`));
        } else {
          if (options.json) {
            try {
              resolve(JSON.parse(output));
            } catch (error) {
              reject(new Error(`Failed to parse JSON: ${error.message}`));
            }
          } else {
            resolve(output.trim());
          }
        }
      });

      console.log(commands);
      sqlite.stdin.write(commands);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  // Define your migration scripts here
  migrationScripts = {
    10: 'ALTER TABLE some_table ADD COLUMN new_column TEXT;',
    11: 'CREATE TABLE new_table (id INTEGER PRIMARY KEY, name TEXT);',
    12: 'ALTER TABLE new_table ADD COLUMN timestamp INTEGER;',
    // Add more migration scripts as needed
  };

  // Example accessor method
  async getUserById(id) {
    if (!this.isInitialized) {
      throw new Error(
        'SQLiteExecutor not initialized. Call initialize() first.'
      );
    }
    const result = await this.execute(`SELECT * FROM users WHERE id = ${id};`, {
      json: true,
    });
    return result[0]; // Assuming id is unique, return the first (and only) result
  }

  async updateNote(fileInfo) {
    if (!this.isInitialized) {
      throw new Error(
        'SQLiteExecutor not initialized. Call initialize() first.'
      );
    }
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
    console.log(updateNoteSQL);
    await this.execute(updateNoteSQL);

    // Update note_tag relationships
    await this.updateNoteTags(fileInfo);

    // Update note_frontmatter relationships
    await this.updateNoteFrontmatter(fileInfo);
  }

  async deleteNote(path) {
    const deleteNoteSQL = `DELETE FROM note WHERE path = '${this.escapeSQLString(
      path
    )}'`;
    await this.execute(deleteNoteSQL);
    // note_tag and note_frontmatter entries will be automatically deleted due to ON DELETE CASCADE
  }

  async updateNoteTags(fileInfo) {
    const { path, tags } = fileInfo;

    // Remove existing note_tag entries for this note
    const deleteNoteTagsSQL = `
      DELETE FROM note_tag 
      WHERE note_path = '${this.escapeSQLString(path)}'
    `;
    await this.execute(deleteNoteTagsSQL);

    // Insert new note_tag entries
    for (let tag of tags) {
      if (tag.startsWith('#')) {
        tag = tag.slice(1);
      }
      tag = this.escapeSQLString(tag);

      const insertNoteTagSQL = `
        INSERT INTO note_tag 
        (note_path, tag_name, tag_name_lower) 
        VALUES 
        ('${this.escapeSQLString(path)}', '${tag}', '${tag.toLowerCase()}')
      `;
      await this.execute(insertNoteTagSQL);
    }
  }

  async updateNoteFrontmatter(fileInfo) {
    const { path, frontmatter } = fileInfo;
    // Remove existing note_frontmatter entries for this note
    const deleteNoteFrontmatterSQL = `
      DELETE FROM note_frontmatter 
      WHERE note_path = '${this.escapeSQLString(path)}'
    `;
    await this.execute(deleteNoteFrontmatterSQL);

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
      await this.execute(insertNoteFrontmatterSQL);
    }
  }

  async updateLastOpened(path) {
    const updateLastOpenedSQL = `
      UPDATE note
      SET last_opened = ${Date.now()}
      WHERE path = '${this.escapeSQLString(path)}'
    `;
    await this.execute(updateLastOpenedSQL);
  }

  escapeSQLString(str) {
    return str.replace(/'/g, "''");
  }
  // Add more accessor methods here as needed for your application

  async runDiagnostics() {
    console.log('Running SQLite Diagnostics');

    // Check file permissions
    fs.access(this.dbPath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
      if (err) {
        console.error('File permission error:', err);
      } else {
        console.log('File permissions: Read/Write OK');
      }
    });

    // Check disk space
    const dbDir = path.dirname(this.dbPath);
    fs.statfs(dbDir, (err, stats) => {
      if (err) {
        console.error('Error checking disk space:', err);
      } else {
        console.log(
          `Available disk space: ${stats.bavail * stats.bsize} bytes`
        );
      }
    });

    // Check SQLite settings
    try {
      const journalMode = await this.execute('PRAGMA journal_mode;');
      console.log('Journal mode:', journalMode);

      const synchronous = await this.execute('PRAGMA synchronous;');
      console.log('Synchronous setting:', synchronous);

      const pageSize = await this.execute('PRAGMA page_size;');
      console.log('Page size:', pageSize);

      const cacheSize = await this.execute('PRAGMA cache_size;');
      console.log('Cache size:', cacheSize);
    } catch (error) {
      console.error('Error checking SQLite settings:', error);
    }

    // Attempt a test write
    try {
      await this.execute(
        'CREATE TABLE IF NOT EXISTS test_write (id INTEGER PRIMARY KEY);'
      );
      await this.execute('INSERT INTO test_write DEFAULT VALUES;');
      const result = await this.execute('SELECT COUNT(*) FROM test_write;');
      console.log('Test write result:', result);
    } catch (error) {
      console.error('Test write failed:', error);
    }

    // Check file stats before and after a write
    fs.stat(this.dbPath, async (err, beforeStat) => {
      if (err) {
        console.error('Error getting file stats:', err);
        return;
      }

      try {
        await this.execute('INSERT INTO test_write DEFAULT VALUES;');

        fs.stat(this.dbPath, (err, afterStat) => {
          if (err) {
            console.error('Error getting file stats after write:', err);
            return;
          }

          console.log(
            'File size before:',
            beforeStat.size,
            'After:',
            afterStat.size
          );
          console.log(
            'File mtime before:',
            beforeStat.mtime,
            'After:',
            afterStat.mtime
          );
        });
      } catch (error) {
        console.error('Error during test write:', error);
      }
    });
  }
}

module.exports = SQLiteExecutor;

// Usage example
async function main() {
  try {
    const executor = await SQLiteExecutor.create('./mydb.sqlite');
    // The database is now initialized and ready to use

    await executor.runDiagnostics();
    const beforeStat = await fs.stat('./mydb.sqlite');
    try {
      await executor.execute(`
        BEGIN IMMEDIATE TRANSACTION;
        INSERT INTO note (path) VALUES ('/path/to/note');
        COMMIT;
      `);
      console.log('Insert operation completed');
    } catch (error) {
      console.error('Insert failed:', error);
    }
    const afterStat = await fs.stat('./mydb.sqlite');
    console.log('File size before:', beforeStat.size, 'After:', afterStat.size);
    console.log(
      'File mtime before:',
      beforeStat.mtime,
      'After:',
      afterStat.mtime
    );

    const count = await executor.execute('SELECT COUNT(*) FROM note;');
    console.log('Number of records in note table:', count);

    // Example of using an accessor method
    // const user = await executor.getUserById(1);
    // console.log(user);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Uncomment the next line to run the example
main();
