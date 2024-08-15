const { Plugin, TFile, Notice } = require('obsidian');
// const DatabaseHandler = require('./DatabaseHandler');
const path = require('path');
const SQLiteExecutor = require('./db');

module.exports = class ObsidianSqliteSync extends Plugin {
  async onload() {
    console.log('loading ObsidianSqliteSync plugin');

    const startTime = performance.now();

    try {
      const pluginDir = path.join(
        this.app.vault.adapter.basePath,
        '.obsidian',
        'plugins',
        this.manifest.id,
        'obsidian.sqlite'
      );

      this.db = await SQLiteExecutor.create(pluginDir);

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

      // Perform a full sync on load
      // await this.fullSync();

      // Schedule periodic full syncs
      // this.registerInterval(
      //   window.setInterval(() => this.fullSync(), 60 * 60 * 1000) // Every hour
      // );

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const formattedTime =
        totalTime >= 1000
          ? `${(totalTime / 1000).toFixed(2)} seconds`
          : `${Math.round(totalTime)} milliseconds`;

      new Notice(`Alfred database initialized in ${formattedTime}`);
    } catch (error) {
      console.error('Failed to initialize sqlite3:', error);
      new Notice(
        'Failed to initialize Alfred database. Check console for details.',
        5000
      );
    }
  }

  onunload() {
    //
  }

  async handleFileModify(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('File modified:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileCreate(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('File created:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileDelete(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('File deleted:', file.path);
      await this.db.deleteNote(file.path);
    }
  }

  async handleFileRename(file, oldPath) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('File renamed from', oldPath, 'to', file.path);
      await this.db.deleteNote(oldPath);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleMetadataChange(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('Metadata changed for file:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileOpen(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('File opened:', file.path);
      await this.db.updateLastOpened(file.path);
    }
  }

  async getFileInfo(file) {
    const maxRetries = 3;
    let retries = 0;
    let cache = null;

    while (retries < maxRetries) {
      cache = this.app.metadataCache.getFileCache(file);
      if (cache) break;
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait 100ms before retrying
      retries++;
    }

    const frontmatter = cache?.frontmatter || {};
    const content = await this.app.vault.read(file);

    console.log('Cache:', cache);

    let tags = [];
    if (cache?.tags) {
      tags = cache.tags.map((tag) => tag.tag);
    } else {
      // Fallback method to extract tags if cache is not available
      const tagRegex = /#[\w\/-]+/g;
      const matches = content.match(tagRegex);
      if (matches) {
        tags = matches.map((tag) => tag.slice(1)); // Remove the '#' character
      }
    }

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

  async fullSync() {
    console.log('Performing full sync');
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }

    console.log('Full sync completed');
  }
};
