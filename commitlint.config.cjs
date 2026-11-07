module.exports = {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  rules: {
    // Match Midscene: require a scope, but do not restrict its name.
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 300],
  },
};
