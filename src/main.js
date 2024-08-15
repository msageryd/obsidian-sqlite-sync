const { Plugin, TFile, Notice } = require('obsidian');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATABASE_VERSION = 1;

module.exports = class ObsidianSqliteSync extends Plugin {
  isInitialLoadComplete = false;

  async onload() {
    console.log('loading ObsidianSqliteSync plugin');

    try {
      this.app.metadataCache.on('resolved', async () => {
        const startTime = performance.now();

        // The cache is now fully initialized
        console.log('Metadata cache is ready');
        await this.initializeDatabase();

        // Perform a full sync on load
        await this.fullSync();
        this.isInitialLoadComplete = true;

        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const formattedTime =
          totalTime >= 1000
            ? `${(totalTime / 1000).toFixed(2)} seconds`
            : `${Math.round(totalTime)} milliseconds`;

        new Notice(`Alfred database initialized in ${formattedTime}`);
      });

      this.registerEvent(
        this.app.vault.on('modify', this.handleFileModify.bind(this))
      );

      this.registerEvent(
        this.app.vault.on('create', this.handleFileCreate.bind(this))
      );

      this.registerEvent(
        this.app.vault.on('delete', this.handleFileDelete.bind(this))
      );

      this.registerEvent(
        this.app.vault.on('rename', this.handleFileRename.bind(this))
      );

      // Register event for metadata changes
      this.registerEvent(
        this.app.metadataCache.on(
          'changed',
          this.handleMetadataChange.bind(this)
        )
      );

      // Register event for file open
      this.registerEvent(
        this.app.workspace.on('file-open', this.handleFileOpen.bind(this))
      );

      // Schedule periodic full syncs
      this.registerInterval(
        window.setInterval(() => this.fullSync(), 60 * 60 * 1000) // Every hour
      );
    } catch (error) {
      console.error('Failed to initialize sqlite3:', error);
      new Notice(
        'Failed to initialize Alfred database. Check console for details.',
        5000
      );
    }
  }

  onunload() {
    console.log('unloading ObsidianSqliteSync plugin');
    if (this.db) {
      this.db.stdin.end();
    }
  }

  async initializeDatabase() {
    const dbPath = path.join(
      app.vault.adapter.basePath,
      '.obsidian',
      'plugins',
      this.manifest.id,
      'alfred_sync.db'
    );

    // // Drop the existing database
    // if (fs.existsSync(dbPath)) {
    //   fs.unlinkSync(dbPath);
    // }

    // Create a new database
    this.db = spawn('sqlite3', [dbPath]);

    this.db.stdout.on('data', (data) => {
      // console.log(`sqlite3 stdout: ${data}`);
    });

    this.db.stderr.on('data', (data) => {
      console.error(`sqlite3 stderr: ${data}`);
    });

    this.db.on('close', (code) => {
      console.log(`sqlite3 process exited with code ${code}`);
    });

    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS system (
        key TEXT PRIMARY KEY,
        value TEXT
      );

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
--        FOREIGN KEY (tag_name) REFERENCES tag(name) ON DELETE CASCADE
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
      this.db.stdin.write(sql + ';\n');
      this.db.stdin.write('.print "QUERY_COMPLETE"\n');

      let output = '';
      const dataHandler = (data) => {
        output += data.toString();
        if (output.includes('QUERY_COMPLETE')) {
          this.db.stdout.removeListener('data', dataHandler);
          resolve(output.replace('QUERY_COMPLETE', '').trim());
        }
      };

      this.db.stdout.on('data', dataHandler);
    });
  }

  async handleFileModify(file) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('File modified:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.updateDatabase(fileInfo);
    }
  }

  async handleFileCreate(file) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('File created:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.insertIntoDatabase(fileInfo);
    }
  }

  async handleFileDelete(file) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('File deleted:', file.path);
      await this.deleteFromDatabase(file.path);
    }
  }

  async handleFileRename(file, oldPath) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('File renamed from', oldPath, 'to', file.path);
      await this.deleteFromDatabase(oldPath);
      const fileInfo = await this.getFileInfo(file);
      await this.insertIntoDatabase(fileInfo);
    }
  }

  async handleMetadataChange(file) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('Metadata changed for file:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.updateDatabase(fileInfo);
    }
  }

  async handleFileOpen(file) {
    if (
      this.isInitialLoadComplete &&
      file instanceof TFile &&
      file.extension === 'md'
    ) {
      console.log('File opened:', file.path);
      const updateLastOpenedSQL = `
        UPDATE note
        SET last_opened = ${Date.now()}
        WHERE path = '${this.escapeSQLString(file.path)}'
      `;
      await this.executeSQL(updateLastOpenedSQL);
    }
  }

  async getFileInfo(file) {
    const content = await this.app.vault.read(file);

    // Before initializing the database in onLoad, we are awaiting cache to be loaded,
    // hence no need for safeguarding against empty cache
    const cache = this.app.metadataCache.getFileCache(file);

    const frontmatter = cache?.frontmatter || {};
    const tags = cache?.tags?.map((tag) => tag.tag) || [];

    const cleanedContent = this.removeMetadataAndTags(
      content,
      frontmatter,
      tags
    );

    return {
      path: file.path,
      title: frontmatter.title || file.basename,
      content: cleanedContent,
      tags: tags,
      frontmatter: frontmatter,
      created: file.stat.ctime,
      last_modified: file.stat.mtime,
    };
  }

  removeMetadataAndTags(content, frontmatter, tags) {
    // Remove frontmatter
    let cleanedContent = content.replace(/^---\n[\s\S]*?\n---\n/, '');

    // Remove tags
    if (tags) {
      tags.forEach((tag) => {
        const tagRegex = new RegExp(`#${tag}\\b`, 'g');
        cleanedContent = cleanedContent.replace(tagRegex, '');
      });
    }

    //convert content to lowercase for case insensitive search
    //Another solution would be to use LOWER() in SQLite, but we cannot trust that the installed sqlite3 has Unicode support
    //Also, converting to lowercase at sync time will be more performant
    cleanedContent = cleanedContent.toLowerCase();

    return cleanedContent.trim();
  }

  async updateDatabase(fileInfo) {
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
    await this.updateNoteFrontmatter(fileInfo);
  }

  async insertIntoDatabase(fileInfo) {
    await this.updateDatabase(fileInfo);
  }

  async deleteFromDatabase(path) {
    const deleteNoteSQL = `DELETE FROM note WHERE path = '${this.escapeSQLString(
      path
    )}'`;
    await this.executeSQL(deleteNoteSQL);
    // note_tag and note_frontmatter entries will be automatically deleted due to ON DELETE CASCADE
  }

  async updateNoteTags(fileInfo) {
    const { path, tags } = fileInfo;

    // Remove existing note_tag entries for this note
    const deleteNoteTagsSQL = `
      DELETE FROM note_tag 
      WHERE note_path = '${this.escapeSQLString(path)}'
    `;
    await this.executeSQL(deleteNoteTagsSQL);

    // Insert new note_tag entries
    for (let tag of tags) {
      if (tag.startsWith('#')) {
        tag = tag.slice(1);
      }
      tag = this.escapeSQLString(tag);

      // const insertTagSQL = `
      //   INSERT OR IGNORE INTO tag (name)
      //   VALUES ('${tag}')
      // `;
      // await this.executeSQL(insertTagSQL);

      const insertNoteTagSQL = `
        INSERT INTO note_tag 
        (note_path, tag_name, tag_name_lower) 
        VALUES 
        ('${this.escapeSQLString(path)}', '${tag}', '${tag.toLowerCase()}')
      `;
      await this.executeSQL(insertNoteTagSQL);
    }
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
      const stringifiedValueLower = JSON.stringify(value).toLocaleLowerCase();
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

  // async syncTags() {
  //   const allTags = this.app.metadataCache.getTags();

  //   // Insert all tags (using INSERT OR IGNORE to avoid duplicates)
  //   for (const tag of Object.keys(allTags)) {
  //     const insertTagSQL = `
  //       INSERT OR IGNORE INTO tag (name) VALUES ('${this.escapeSQLString(
  //         tag.slice(1)
  //       )}')
  //     `;
  //     await this.executeSQL(insertTagSQL);
  //   }

  //   // Remove tags that are no longer used
  //   const removeUnusedTagsSQL = `
  //     DELETE FROM tag
  //     WHERE name NOT IN (SELECT DISTINCT tag_name FROM note_tag)
  //   `;
  //   await this.executeSQL(removeUnusedTagsSQL);
  // }

  async fullSync() {
    console.log('Performing full sync');
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const fileInfo = await this.getFileInfo(file);
      await this.insertIntoDatabase(fileInfo);
    }

    // await this.syncTags();

    console.log('Full sync completed');
  }

  escapeSQLString(str) {
    return str.replace(/'/g, "''");
  }
};
