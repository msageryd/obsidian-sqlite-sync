const SQLiteAdapter = require('../src/db');

async function main() {
  console.log('Running SQLite Tests');
  const dbPath = './test/test.sqlite';
  let sqlite;

  try {
    sqlite = await SQLiteAdapter.create(dbPath, { logging: true });
  } catch (error) {
    console.error('Error:', error);
  }

  const fileInfo1 = {
    path: 'test1.md',
    title: 'Test Note X1',
    content: 'This is test note 1',
    tags: ['#test', '#test1'],
    frontmatter: {
      test: 'test',
      test2: 'test2',
    },
    created: Date.now(),
    last_modified: Date.now(),
  };

  const fileInfo2 = {
    path: 'test2.md',
    title: 'Test Note Y2',
    content: 'This is test note 2',
    tags: ['#test', '#test2'],
    frontmatter: {
      test: 'test',
      test2: 'test2',
    },
    created: Date.now(),
    last_modified: Date.now(),
  };

  await sqlite.updateNote([fileInfo1, fileInfo2]);
  await sqlite.updateLastOpened(fileInfo1.path);

  await sqlite.deleteNote(fileInfo2.path);
}

main();
