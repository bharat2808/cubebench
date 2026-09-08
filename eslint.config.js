import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['dist/**','node_modules/**','playwright-report/**','test-results/**','docs/research/**']},js.configs.recommended,...tseslint.configs.recommended,{files:['**/*.ts','**/*.tsx'],rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'@typescript-eslint/no-explicit-any':'error'}},{files:['**/*.js'],languageOptions:{globals:{process:'readonly',console:'readonly'}}});
