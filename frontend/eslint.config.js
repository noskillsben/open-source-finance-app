import js from '@eslint/js'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist'] },
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: 'readonly', document: 'readonly', fetch: 'readonly', console: 'readonly', process: 'readonly' } },
    settings: { react: { version: '18.3' } },
    rules: { ...react.configs.recommended.rules, ...reactHooks.configs.recommended.rules, 'react/react-in-jsx-scope': 'off', 'react/prop-types': 'off' },
  },
]
