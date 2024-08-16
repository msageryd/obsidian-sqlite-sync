const SQLiteAdapter = require('./db');
const fs = require('fs').promises;
const path = require('path');

async function runDiagnostics() {
  console.log('Running SQLite Diagnostics');
  const dbPath = './test/diags.sqlite';
  let sqlite;

  try {
    sqlite = await SQLiteAdapter.create(dbPath, { logging: true });
  } catch (error) {
    console.error('Error:', error);
  }

  // Check file permissions
  try {
    await fs.access(dbPath, fs.constants.R_OK | fs.constants.W_OK);
    console.log('File permissions: Read/Write OK');
  } catch (error) {
    console.error('File permission error:', error);
  }

  // Check disk space
  const dbDir = path.dirname(dbPath);
  try {
    const stats = await fs.stat(dbDir);
    console.log(`Available disk space: ${stats.bavail * stats.bsize} bytes`);
  } catch (error) {
    console.error('Error checking disk space:', error);
  }

  // Check SQLite settings
  try {
    console.log('Journal mode:', await sqlite.execute('PRAGMA journal_mode;'));
    console.log(
      'Synchronous setting:',
      await sqlite.execute('PRAGMA synchronous;')
    );
    console.log('Page size:', await sqlite.execute('PRAGMA page_size;'));
    console.log('Cache size:', await sqlite.execute('PRAGMA cache_size;'));
  } catch (error) {
    console.error('Error checking SQLite settings:', error);
  }

  // Attempt a test write
  try {
    await sqlite.execute(
      'CREATE TABLE IF NOT EXISTS test_write (id INTEGER PRIMARY KEY);'
    );
    await sqlite.execute('INSERT INTO test_write DEFAULT VALUES;');
    const result = await sqlite.execute('SELECT COUNT(*) FROM test_write;');
    console.log('Test write result:', result);
  } catch (error) {
    console.error('Test write failed:', error);
  }

  // Check file stats before and after a write
  try {
    const beforeStat = await fs.stat(dbPath);
    await sqlite.execute('INSERT INTO test_write DEFAULT VALUES;');
    const afterStat = await fs.stat(dbPath);
    console.log('File size before:', beforeStat.size, 'After:', afterStat.size);
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

runDiagnostics();
