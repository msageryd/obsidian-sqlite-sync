const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const dbSql = require('./db.sql');

class SQLiteAdapter {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.isInitialized = false;
    this.logging = options.logging || false;
  }

  static async create(dbPath, options = {}) {
    const sqlite = new SQLiteAdapter(dbPath, options);
    await sqlite.initialize();
    return sqlite;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      const initResult = await this.initializeDatabase();
      this.logging && console.log(initResult.message);
      this.isInitialized = true;
    } catch (error) {
      this.logging && console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  async execute(commands, timeout = 5000) {
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

      this.logging && console.log('Executing SQL:', commands);
      sqlite.stdin.write(commands);
      sqlite.stdin.write('\n.exit\n');
      sqlite.stdin.end();
    });
  }

  async initializeDatabase() {
    const versionTableExists = await this.execute(
      dbSql.checkVersionTableExists
    );
    if (!versionTableExists) {
      await this.createNewDatabase();
      return {
        status: 'created',
        message: `New database created with version ${dbSql.CURRENT_VERSION}.`,
      };
    }

    const currentVersionResult = await this.execute(dbSql.getVersion);
    const currentVersion = parseInt(currentVersionResult) || 0;

    if (currentVersion < dbSql.MIN_MIGRATION_VERSION) {
      await this.createNewDatabase();
      return {
        status: 'reset',
        message: `Database was recreated with version ${dbSql.CURRENT_VERSION}.`,
      };
    } else if (currentVersion < dbSql.CURRENT_VERSION) {
      await this.upgradeDatabase(currentVersion);
      return {
        status: 'upgraded',
        message: `Database structure upgraded from version ${currentVersion} to ${dbSql.CURRENT_VERSION}.`,
      };
    } else {
      return {
        status: 'current',
        message: `Database structure is up to date, version ${currentVersion}.`,
      };
    }
  }

  async createNewDatabase() {
    const exists = await fs.access(this.dbPath);
    if (exists) {
      fs.unlinkSync(this.dbPath);
    }

    await this.execute(dbSql.createDatabase);
    await this.execute(dbSql.updateVersion);
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

  // Example accessor method
  async getUserById(id) {
    if (!this.isInitialized) {
      throw new Error(
        'SQLiteExecutor not initialized. Call initialize() first.'
      );
    }
    const result = await this.execute(`SELECT * FROM users WHERE id = ${id};`);
    return JSON.parse(result)[0]; // Assuming id is unique, return the first (and only) result
  }

  // Add more accessor methods here as needed for your application
}

module.exports = SQLiteAdapter;
