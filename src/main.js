#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
// import { fileURLToPath } from 'url';
import {
	metadataFilename,
	MAIN_SUBFILES,
	AD_SUBFILES
} from './constants.js';
import { extractDecrypted } from './extraction.js';
import { rebuildDecrypted } from './rebuilding.js';
// import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const __cwd = process.cwd();
if (process.argv.length <= 3) {
	throw new Error('"extract"/"rebuild" and input file required');
}
const extractOrRebuild = process.argv[2];
const inFilePath = process.argv[3];
const inFilePathFull = path.join(__cwd, inFilePath);

let extractMode;
switch (extractOrRebuild) {
	case 'extract':
		extractMode = true;
		break;
	case 'rebuild':
		extractMode = false;
		break;
	default:
		throw new Error(`"${extractOrRebuild}" is not "extract" or "rebuild"`);
}
if (extractMode) {
	const outFilePathFull = inFilePathFull;
	const inFileData = fs.readFileSync(inFilePathFull);
	const { metadata, subfiles } = extractDecrypted(inFileData);

	fs.writeFileSync(metadataFilename(outFilePathFull), JSON.stringify(metadata, null, '\t'));
	MAIN_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull), subfiles[key]));
	subfiles.ads.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull, i), adSubfiles[key])));
} else {
	rebuildDecrypted(inFilePathFull);
}
