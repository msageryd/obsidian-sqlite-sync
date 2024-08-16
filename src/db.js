const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const dbSql = require('./db.sql');

class SQLiteAdapter {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.isInitialized = false;
    this.logging = options.logging || false;
    this.queue = new Map();
    this.isProcessing = false;
  }

  static async create(dbPath, options = {}) {
    const sqlite = new SQLiteAdapter(dbPath, options);
    await sqlite.initialize();
    return sqlite;
  }

  async initialize() {
    if (this.isInitialized) return;

    console.log('[SQLite-sync] Initializing database');
    try {
      const initResult = await this.initializeDatabase();
      this.logging && console.log(initResult.message);
      this.isInitialized = true;
    } catch (error) {
      console.error('[SQLite-sync] Failed to initialize database:');
      console.error(error);
      throw error;
    }
  }

  async execute(commands, options = {}) {
    const noInitCheck = options.noInitCheck || false;
    const timeout = options.timeout || 5000;

    if (!noInitCheck && !this.isInitialized) {
      throw new Error(
        'SQLiteExecutor not initialized. Call initialize() first.'
      );
    }

    return new Promise((resolve, reject) => {
      const sqlite = spawn('sqlite3', [this.dbPath]);
      let output = '';
      let errorOutput = '';

      const timer = setTimeout(() => {
        sqlite.kill();
        reject(
          new Error(
            `[SQLite-sync] SQLite query timed out after ${timeout}ms. Normally, this should take a couple of ms, or a couple of 100ms at first init. Something is very wrong`
          )
        );
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
              `[SQLite-sync] SQLite process exited with code ${code}. Error: ${errorOutput}`
            )
          );
        } else {
          resolve(output.trim());
        }
      });

      this.logging && console.log('----------------------------');
      this.logging && console.log('Executing SQL:');
      this.logging && console.log(commands);

      sqlite.stdin.write(commands);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async initializeDatabase() {
    let currentVersion;
    try {
      const currentVersionResult = await this.execute(dbSql.getVersion);
      currentVersion = parseInt(currentVersionResult) || 0;
    } catch (error) {
      this.logging &&
        console.error(
          '[SQLite-sync] Failed to check version table, recreating database'
        );

      await this.createNewDatabase();
      return {
        status: 'created',
        message: `[SQLite-sync] New database created with version ${dbSql.CURRENT_VERSION}.`,
      };
    }

    if (currentVersion < dbSql.MIN_MIGRATION_VERSION) {
      await this.createNewDatabase();
      return {
        status: 'reset',
        message: `[SQLite-sync] Database was recreated with version ${dbSql.CURRENT_VERSION}.`,
      };
    } else if (currentVersion < dbSql.CURRENT_VERSION) {
      await this.upgradeDatabase(currentVersion);
      return {
        status: 'upgraded',
        message: `[SQLite-sync] Database structure upgraded from version ${currentVersion} to ${dbSql.CURRENT_VERSION}.`,
      };
    } else {
      return {
        status: 'current',
        message: `[SQLite-sync] Database structure is up to date, version ${currentVersion}.`,
      };
    }
  }

  async createNewDatabase() {
    try {
      await fs.unlink(this.dbPath);
    } catch (error) {
      console.error('[SQLite-sync] Failed to delete database file:', error);
    }

    await this.execute(dbSql.createDatabase, { noInitCheck: true });
    await this.execute(dbSql.updateVersion, { noInitCheck: true });
  }

  async upgradeDatabase(fromVersion) {
    for (let v = fromVersion + 1; v <= dbSql.CURRENT_VERSION; v++) {
      if (!dbSql.migrate[v]) {
        throw new Error(`Missing migration script for version ${v}`);
      }
      await this.execute(dbSql.migrate[v]);
    }
    await this.execute(dbSql.updateVersion);
  }

  async deleteNote(path) {
    const deleteNoteSQL = dbSql.getDeleteNoteSql(path);

    // note_tag and note_frontmatter entries will be automatically cascade deleted
    await this.queueOperation(async () => {
      await this.execute(deleteNoteSQL);
    }, path);
  }

  async updateNote(fileInfo) {
    let queueKey = Array.isArray(fileInfo) ? null : fileInfo.path;
    const updateNoteSQL = dbSql.getUpdateNoteSql(fileInfo);
    const updateTagsSQL = dbSql.getUpdateTagsSql(fileInfo);
    const updateFrontmatterSQL = dbSql.getUpdateFrontmatterSql(fileInfo);

    await this.queueOperation(async () => {
      await this.execute(
        `${updateNoteSQL} ${updateTagsSQL} ${updateFrontmatterSQL}`
      );
    }, queueKey);
  }

  async updateLastOpened(path) {
    const updateLastOpenedSQL = dbSql.getUpdateLastOpenedSql(path);
    await this.queueOperation(async () => {
      await this.execute(updateLastOpenedSQL);
    });
  }

  async queueOperation(operation, notePath = null) {
    return new Promise((resolve, reject) => {
      const key = notePath || `pseudo_key_${Date.now()}_${Math.random()}`;
      // console.log(`Operation queued: ${key}`);
      this.queue.set(key, {
        operation,
        resolve: (result) => {
          // console.log(`Operation resolved: ${key}`);
          resolve(result);
        },
        reject: (error) => {
          // console.error(`Operation rejected: ${key}`, error);
          reject(error);
        },
      });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.size === 0) return;

    this.isProcessing = true;
    const [key, { operation, resolve, reject }] = this.queue
      .entries()
      .next().value;
    this.queue.delete(key);

    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }
}

module.exports = SQLiteAdapter;
