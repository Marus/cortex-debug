import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['out/', 'dist/'],
    },
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    stylistic.configs.customize({
        arrowParens: 'always',
        braceStyle: '1tbs',
        commaDangle: 'only-multiline',
        indent: 4,
        quotes: 'single',
        semi: 'always',
    }),
    {
        files: ['resources/*.js'],
        languageOptions: {
            globals: {
                acquireVsCodeApi: true,      // available for VSCode WebViews
            },
        },
    },
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
            },
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },

        rules: {
            '@typescript-eslint/no-base-to-string': 'off',              // 1 instance

            '@stylistic/indent-binary-ops': 'off',      // this is a weird rule
            '@stylistic/max-len': ['error', {
                code: 160,
                ignoreTrailingComments: true,
            }],
            '@stylistic/max-statements-per-line': ['error', {
                ignoredNodes: ['IfStatement'],
            }],
            '@stylistic/member-delimiter-style': ['error', {
                multiline: { delimiter: 'semi' },
                singleline: { delimiter: 'semi' },
            }],
            '@stylistic/no-multi-spaces': ['error', {
                ignoreEOLComments: true,
            }],
            '@stylistic/quote-props': ['error', 'as-needed', {
                unnecessary: false,
            }],
        }
    },
    {
        // the following rules are being heavily violated in the current codebase,
        // we should work on being able to enable them...
        rules: {
            '@typescript-eslint/no-unsafe-member-access': 'off',        // 742 instances
            '@typescript-eslint/no-unsafe-call': 'off',                 // 432 instances
            '@typescript-eslint/no-unsafe-assignment': 'off',           // 429 instances
            '@typescript-eslint/no-unsafe-argument': 'off',             // 401 instances
            '@typescript-eslint/no-explicit-any': 'off',                // 226 instances
            '@typescript-eslint/no-unused-vars': 'off',                 // 204 instances
            '@typescript-eslint/no-unsafe-return': 'off',               // 83 instances
            '@typescript-eslint/no-misused-promises': 'off',            // 57 instances
            '@typescript-eslint/no-floating-promises': 'off',           // 55 instances
            'no-useless-escape': 'off',                                 // 38 instances
            '@typescript-eslint/prefer-promise-reject-errors': 'off',   // 36 instances
            'no-async-promise-executor': 'off',                         // 29 instances
            '@typescript-eslint/require-await': 'off',                  // 11 instances
        }
    },
    {
        files: ['**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        files: ['**/*.js'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        }
    }
);
