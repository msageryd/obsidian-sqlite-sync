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
      throw error;
    }
  }

  async executeSQLite(commands, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [this.dbPath]);
      let output = '';
      let errorOutput = '';

      const timer = setTimeout(() => {
        sqlite.kill();
        reject(new Error('SQLite process timed out'));
      }, timeout);

      sqlite.stdout.on('data', (data) => {
        output += data.toString();
      });

      sqlite.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      sqlite.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `SQLite process exited with code ${code}. Error: ${errorOutput}`
            )
          );
        } else {
          resolve(output.trim());
        }
      });

      console.log('Executing SQL:', commands);
      sqlite.stdin.write(commands);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async initializeDatabase() {
    const versionTableExists = await this.executeSQLite(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='version';"
    );

    if (!versionTableExists) {
      await this.createNewDatabase();
      return { status: 'created', message: 'New database created.' };
    }

    const currentVersionResult = await this.executeSQLite(
      'SELECT version FROM version LIMIT 1;'
    );
    const currentVersion = parseInt(currentVersionResult) || 0;

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
  }

  async createNewDatabase() {
    await this.executeSQLite(`
      CREATE TABLE version (version INTEGER PRIMARY KEY);
      INSERT INTO version (version) VALUES (${this.CURRENT_VERSION});
      -- Add other initial table creation SQL here
    `);
  }

  async upgradeDatabase(fromVersion) {
    for (let v = fromVersion + 1; v <= this.CURRENT_VERSION; v++) {
      if (this.migrationScripts[v]) {
        await this.executeSQLite(this.migrationScripts[v]);
      }
    }
    await this.executeSQLite(
      `UPDATE version SET version = ${this.CURRENT_VERSION};`
    );
  }

  async runDiagnostics() {
    console.log('Running SQLite Diagnostics');

    // Check file permissions
    try {
      await new Promise((resolve, reject) => {
        fs.access(this.dbPath, fs.constants.R_OK | fs.constants.W_OK, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.log('File permissions: Read/Write OK');
    } catch (error) {
      console.error('File permission error:', error);
    }

    // Check disk space (using callback version)
    const dbDir = path.dirname(this.dbPath);
    try {
      await new Promise((resolve, reject) => {
        fs.statfs(dbDir, (err, stats) => {
          if (err) reject(err);
          else {
            console.log(
              `Available disk space: ${stats.bavail * stats.bsize} bytes`
            );
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Error checking disk space:', error);
    }

    // Check SQLite settings
    try {
      console.log(
        'Journal mode:',
        await this.executeSQLite('PRAGMA journal_mode;')
      );
      console.log(
        'Synchronous setting:',
        await this.executeSQLite('PRAGMA synchronous;')
      );
      console.log('Page size:', await this.executeSQLite('PRAGMA page_size;'));
      console.log(
        'Cache size:',
        await this.executeSQLite('PRAGMA cache_size;')
      );
    } catch (error) {
      console.error('Error checking SQLite settings:', error);
    }

    // Attempt a test write
    try {
      await this.executeSQLite(
        'CREATE TABLE IF NOT EXISTS test_write (id INTEGER PRIMARY KEY);'
      );
      await this.executeSQLite('INSERT INTO test_write DEFAULT VALUES;');
      const result = await this.executeSQLite(
        'SELECT COUNT(*) FROM test_write;'
      );
      console.log('Test write result:', result);
    } catch (error) {
      console.error('Test write failed:', error);
    }

    // Check file stats before and after a write
    try {
      const beforeStat = await new Promise((resolve, reject) => {
        fs.stat(this.dbPath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats);
        });
      });
      await this.executeSQLite('INSERT INTO test_write DEFAULT VALUES;');
      const afterStat = await new Promise((resolve, reject) => {
        fs.stat(this.dbPath, (err, stats) => {
          if (err) reject(err);
          else resolve(stats);
        });
      });
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
    } catch (error) {
      console.error('Error during file stat check:', error);
    }
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
    const result = await this.executeSQLite(
      `SELECT * FROM users WHERE id = ${id};`
    );
    return JSON.parse(result)[0]; // Assuming id is unique, return the first (and only) result
  }

  // Add more accessor methods here as needed for your application
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
