const stopword = require('stopword');

// Function to dynamically get language stopwords
const getLanguageStopwords = (languages) => {
  return languages.flatMap((lang) => {
    if (stopword[lang]) {
      return stopword[lang];
    } else {
      console.warn(`Stopwords not found for language: ${lang}`);
      return [];
    }
  });
};

module.exports.escapeSQLString = (str) => str.replace(/'/g, "''");

module.exports.cleanTextForSearch = (text, languages = ['eng']) => {
  if (typeof text !== 'string') return '';

  text = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-–]/gu, '') // Remove all characters except letters, numbers, whitespace, and dashes
    .replace(/\s+/g, ' ') // Replace multiple whitespace characters with a single space
    .trim(); // Remove leading and trailing whitespace

  const stopwords = getLanguageStopwords(languages);
  text = stopword.removeStopwords(text.split(' '), stopwords).join(' ');

  return text;
};
