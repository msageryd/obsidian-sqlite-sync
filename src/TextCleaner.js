const { removeStopwords } = require('stopword');
const path = require('path');

class TextCleaner {
  constructor(pluginRootDir, languages) {
    this.pluginRootDir = pluginRootDir;
    this.languages = languages;
    this.stopwords = this.getLanguageStopwords();
  }

  getLanguageStopwords() {
    return this.languages.reduce((acc, lang) => {
      console.log(`[SQLite-sync] Loading stopwords for language: ${lang}`);
      try {
        const stopwordPath = path.join(
          this.pluginRootDir,
          'stopwords',
          `stopwords_${lang}.js`
        );
        const languageStopwords = require(stopwordPath);
        return acc.concat(languageStopwords[lang]);
      } catch (error) {
        console.warn(`Stopwords not found for language: ${lang}`, error);
        return acc;
      }
    }, []);
  }

  cleanTextForSearch(text) {
    if (typeof text !== 'string') return '';

    text = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s\-–//]/gu, '') // Remove all characters except letters, numbers, whitespace, and dashes and slashes
      .replace(/\s+/g, ' ') // Replace multiple whitespace characters with a single space
      .trim(); // Remove leading and trailing whitespace

    return removeStopwords(text.split(' '), this.stopwords).join(' ');
  }
}

module.exports = TextCleaner;
