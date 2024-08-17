const {
  Plugin,
  TFile,
  Notice,
  PluginSettingTab,
  Setting,
  MarkdownView,
} = require('obsidian');
const path = require('path');
const SQLiteExecutor = require('./db');
const TextCleaner = require('./TextCleaner');

class ObsidianSqliteSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'SQLite Sync Settings' });

    new Setting(containerEl)
      .setName('Stopword Languages')
      .setDesc(
        'Comma-separated list of language codes for stopword removal (e.g., eng,fra,deu)'
      )
      .addText((text) =>
        text
          .setPlaceholder('eng')
          .setValue(this.plugin.settings.stopwordLanguages.join(','))
          .onChange(async (value) => {
            this.plugin.settings.stopwordLanguages = value
              .split(',')
              .map((lang) => lang.trim());
            await this.plugin.saveSettings();
          })
      );
  }
}

module.exports = class ObsidianSqliteSync extends Plugin {
  isInitialized = false;
  settings = {
    stopwordLanguages: ['eng'],
  };

  async loadSettings() {
    this.settings = Object.assign({}, this.settings, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async onload() {
    console.log('[SQLite-sync] Loading Obsidian-sqlite-sync plugin');
    const pluginRootDir = this.app.vault.adapter.getFullPath(this.manifest.dir);
    await this.loadSettings();

    this.addSettingTab(new ObsidianSqliteSyncSettingTab(this.app, this));

    try {
      this.textCleaner = new TextCleaner(
        pluginRootDir,
        this.settings.stopwordLanguages
      );
    } catch (error) {
      console.error('[SQLite-sync] Failed to initialize text cleaner:', error);
      new Notice(
        'Failed to initialize text cleaner. Check console for details.',
        5000
      );
    }

    try {
      const dbPath = path.join(pluginRootDir, 'obsidian.sqlite');
      this.db = await SQLiteExecutor.create(dbPath);
    } catch (error) {
      console.error('[SQLite-sync] Failed to initialize sqlite3:', error);
      new Notice(
        'Failed to initialize SQLite database. Check console for details.',
        5000
      );
    }

    console.log('[SQLite-sync] Waiting for Obsidian to load cache');

    this.app.metadataCache.on('resolved', async () => {
      if (this.isInitialized) {
        return;
      }

      try {
        // Perform a full sync on load
        const startTime = performance.now();
        await this.fullSync();

        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const formattedTime =
          totalTime >= 1000
            ? `${(totalTime / 1000).toFixed(2)} seconds`
            : `${Math.round(totalTime)} milliseconds`;

        console.log(
          `[SQLite-sync] SQLite database initialized in ${formattedTime}`
        );
        new Notice(`SQLite database initialized in ${formattedTime}`);

        this.isInitialized = true;
        console.log('[SQLite-sync] Initialization completed');
      } catch (error) {
        console.error('[SQLite-sync] Failed to perform full sync:', error);
        new Notice(
          'Failed to initialize SQLite database. Check console for details.',
          5000
        );
      }

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

      this.registerEvent(
        this.app.workspace.on('active-leaf-change', (leaf) => {
          if (leaf.view instanceof MarkdownView) {
            const file = leaf.view.file;
            this.handleFileFocused(file);
          }
        })
      );

      console.log(
        '[SQLite-sync] All events registered, now listening for changes'
      );
    });
  }

  onunload() {
    console.log('[SQLite-sync] Unloading Obsidian-sqlite-sync plugin');
    this.isInitialized = false;
  }

  async handleFileModify(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File modified:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileCreate(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File created:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileDelete(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File deleted:', file.path);
      await this.db.deleteNote(file.path);
    }
  }

  async handleFileRename(file, oldPath) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File renamed from', oldPath, 'to', file.path);
      await this.db.deleteNote(oldPath);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleMetadataChange(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] Metadata changed for file:', file.path);
      const fileInfo = await this.getFileInfo(file);
      await this.db.updateNote(fileInfo);
    }
  }

  async handleFileOpen(file) {
    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File opened:', file.path);
      await this.db.updateLastOpened(file.path);
    }
  }

  async handleFileFocused(file) {
    //handleFileOpen seems to be called even when the file is already opened and gets focused
    //so handleFileFocused is not needed for now
    return;

    if (file instanceof TFile && file.extension === 'md') {
      console.log('[SQLite-sync] File focused in workspace:', file.path);
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

    const cleanedContent = this.textCleaner.cleanTextForSearch({
      text: content,
      frontmatter,
      tags,
    });

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

  async fullSync() {
    console.log('[SQLite-sync] Starting full sync');
    const files = this.app.vault.getMarkdownFiles();

    const filePromiseArray = files.map(async (file) => {
      return this.getFileInfo(file);
    });
    const fileInfoArray = await Promise.all(filePromiseArray);
    await this.db.updateNote(fileInfoArray);

    console.log(
      `[SQLite-sync] Full sync completed, ${files.length} files processed`
    );
  }
};
