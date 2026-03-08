#!/usr/bin/env node
// TODO: Rename this file to "example.js" and export "extraction.js" and "rebuilding.js"

import fs from 'fs';
import path from 'path';
import { keyInYN } from 'readline-sync';
// import { fileURLToPath } from 'url';
import { extractDecrypted } from './extraction.js';
import { rebuildDecrypted } from './rebuilding.js';
// import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';

export const MAIN_SUBFILES = [
	{ key: 'video', filename: filename => `${filename}.video.moflex` },
	{ key: 'thumbnail', filename: filename => `${filename}.thumb.jpg` }
];

export const AD_SUBFILES = [
	{ key: 'image', filename: (filename, index) => `${filename}.ad${index + 1}.jpg` }
];

export const metadataFilename = filename => `${filename}.meta.json`;

const userApprovesOverwrite = (filenames, description, yOverride) => {
	if (yOverride) {
		return true;
	}

	const filesToBeOverwritten = filenames.filter(filename => fs.existsSync(filename));
	const filesToBeOverwrittenCount = filesToBeOverwritten.length;

	return filesToBeOverwrittenCount
		? keyInYN(`WARNING: The following ${description ? `${description} ` : ''} file${filesToBeOverwrittenCount === 1 ? '' : 's'} will be overwritten:\n${filesToBeOverwritten.join('\n')}\nIs this OK? (this can be overridden with the "-y" option)`)
		: true;
};

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
		throw new Error(`${JSON.stringify(extractOrRebuild)} is not "extract" or "rebuild"`);
}
if (extractMode) {
	const outFilePathFull = inFilePathFull;
	const inFileData = fs.readFileSync(inFilePathFull);
	const { metadata, mainSubfiles, adsSubfiles } = extractDecrypted(inFileData);

	fs.writeFileSync(metadataFilename(outFilePathFull), JSON.stringify(metadata, null, '\t'));
	MAIN_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull), mainSubfiles[key]));
	adsSubfiles.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull, i), adSubfiles[key])));
} else {
	const builtBuffer = rebuildDecrypted(inFilePathFull);
	if (userApprovesOverwrite([inFilePathFull], 'decrypted', false)) {
		fs.writeFileSync(inFilePathFull, builtBuffer);
	}
}
