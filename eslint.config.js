'use strict';

const js = require('@eslint/js');
const pluginN = require('eslint-plugin-n');
const pluginPromise = require('eslint-plugin-promise');
const globals = require('globals');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // Base recommended rules
  js.configs.recommended,

  // Main source configuration
  {
    files: ['src/**/*.js'],
    plugins: {
      n: pluginN,
      promise: pluginPromise
    },
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    rules: {
      // Error prevention
      'no-console': 'off',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_',
        'caughtErrorsIgnorePattern': '^_'
      }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-duplicate-imports': 'error',

      // Code style
      'indent': ['error', 2, { 'SwitchCase': 1 }],
      'linebreak-style': ['error', 'unix'],
      'quotes': ['error', 'single', { 'avoidEscape': true }],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'comma-spacing': ['error', { 'before': false, 'after': true }],
      'comma-style': ['error', 'last'],
      'key-spacing': ['error', { 'beforeColon': false, 'afterColon': true }],
      'keyword-spacing': ['error', { 'before': true, 'after': true }],
      'space-before-blocks': ['error', 'always'],
      'space-before-function-paren': ['error', {
        'anonymous': 'always',
        'named': 'never',
        'asyncArrow': 'always'
      }],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'space-unary-ops': ['error', { 'words': true, 'nonwords': false }],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'brace-style': ['error', '1tbs', { 'allowSingleLine': true }],

      // Best practices
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'dot-notation': 'error',
      'no-else-return': 'error',
      'no-empty-function': 'error',
      'no-extra-bind': 'error',
      'no-floating-decimal': 'error',
      'no-implicit-coercion': 'error',
      'no-implicit-globals': 'error',
      'no-lone-blocks': 'error',
      'no-multi-spaces': 'error',
      'no-new': 'error',
      'no-new-wrappers': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'prefer-promise-reject-errors': 'error',
      'radix': 'error',
      'require-await': 'error',
      'yoda': 'error',

      // ES6+
      'arrow-spacing': ['error', { 'before': true, 'after': true }],
      'constructor-super': 'error',
      'no-class-assign': 'error',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-new-symbol': 'error',
      'no-this-before-super': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': 'error',
      'prefer-destructuring': ['error', {
        'array': false,
        'object': true
      }],
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'rest-spread-spacing': ['error', 'never'],
      'template-curly-spacing': ['error', 'never'],

      // Node.js specific (via eslint-plugin-n)
      'n/callback-return': 'error',
      'n/global-require': 'error',
      'n/handle-callback-err': 'error',
      'n/no-mixed-requires': 'error',
      'n/no-new-require': 'error',
      'n/no-path-concat': 'error',
      'n/no-process-exit': 'error',
      'n/no-sync': 'warn'
    }
  },

  // Test files override
  {
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
        // Test globals from setup.js
        'createMockCVE': 'readonly',
        'createMockPage': 'readonly',
        'createMockBrowser': 'readonly',
        'waitFor': 'readonly',
        'createTempDir': 'readonly',
        'cleanupTempDir': 'readonly',
        'fetch': 'writable'
      }
    },
    rules: {
      'no-unused-expressions': 'off',
      'n/no-process-exit': 'off'
    }
  },

  // CLI and server entry-point overrides — allow process.exit() and dynamic requires
  {
    files: ['src/app.js', 'src/api.js'],
    rules: {
      'n/no-process-exit': 'off',
      'n/global-require': 'off'
    }
  }
];
