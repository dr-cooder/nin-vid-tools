import eslintConfig from '@pretendonetwork/eslint-config';
import globals from 'globals';

export default [
	...eslintConfig,
	{
		languageOptions: {
			sourceType: 'module',
			globals: {
				...globals.node
			}
		}
	}
];
