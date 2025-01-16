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
            '@stylistic/max-len': ['error', {
                code: 160,
                ignoreTrailingComments: true,
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
            '@typescript-eslint/no-require-imports': 'off',             // 24 instances
            'no-cond-assign': 'off',                                    // 21 instances
            'no-empty': 'off',                                          // 19 instances
            '@typescript-eslint/restrict-template-expressions': 'off',  // 17 instances
            'prefer-const': 'off',                                      // 13 instances
            '@typescript-eslint/require-await': 'off',                  // 11 instances
            'no-prototype-builtins': 'off',                             // 10 instances
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',      // 9 instances
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',  // 8 instances
            'no-constant-condition': 'off',                             // 8 instances
            '@typescript-eslint/unbound-method': 'off',                 // 7 instances
            'no-case-declarations': 'off',                              // 6 instances
            'no-undef': 'off',                                          // 4 instances
            'no-useless-catch': 'off',                                  // 4 instances
            '@typescript-eslint/no-redundant-type-constituents': 'off', // 3 instances
            'no-fallthrough': 'off',                                    // 2 instances
            '@typescript-eslint/no-unsafe-function-type': 'off',        // 2 instances
            '@typescript-eslint/no-unused-expressions': 'off',          // 2 instances
            '@typescript-eslint/no-for-in-array': 'off',                // 2 instances
            '@typescript-eslint/no-base-to-string': 'off',              // 1 instance
            '@typescript-eslint/no-duplicate-type-constituents': 'off', // 1 instance
            'no-duplicate-case': 'off',                                 // 1 instance
            '@typescript-eslint/await-thenable': 'off',                 // 1 instance
            'no-self-assign': 'off',                                    // 1 instance

            '@stylistic/indent': 'off',                         // 450 instances
            '@stylistic/brace-style': 'off',                    // 349 instances
            '@stylistic/max-statements-per-line': 'off',        // 178 instances
            '@stylistic/no-trailing-spaces': 'off',             // 131 instances
            '@stylistic/no-tabs': 'off',                        // 109 instances
            '@stylistic/object-curly-spacing': 'off',           // 87 instances
            '@stylistic/operator-linebreak': 'off',             // 49 instances
            '@stylistic/no-multi-spaces': 'off',                // 49 instances
            '@stylistic/indent-binary-ops': 'off',              // 48 instances
            '@stylistic/member-delimiter-style': 'off',         // 42 instances
        }
    },
    {
        files: ['**/*.{js,mjs}'],
        extends: [tseslint.configs.disableTypeChecked],
    },
);
