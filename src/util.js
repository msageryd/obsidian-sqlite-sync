const { removeStopwords, swe, eng } = require('stopword');

module.exports.escapeSQLString = (str) => str.replace(/'/g, "''");

module.exports.cleanTextForSearch = (text) => {
  if (typeof text !== 'string') return '';

  text = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-–]/gu, '') // Remove all characters except letters, numbers, whitespace, and dashes
    .replace(/\s+/g, ' ') // Replace multiple whitespace characters with a single space
    .trim(); // Remove leading and trailing whitespace

  text = removeStopwords(text.split(' '), swe).join(' ');

  return text;
};
