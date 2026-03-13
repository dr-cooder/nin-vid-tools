#!/usr/bin/env node
// TODO: Rename this file to "nin-vid-tools.js" and export "extraction.js" and "rebuilding.js"

import fs from 'fs';
// import path from 'path';
import { program } from 'commander';
import { keyInYN } from 'readline-sync';
import { extractDecrypted } from './extraction.js';
import { rebuildDecrypted } from './rebuilding.js';
import { isType } from './helpers.js';

// TODO: decrypt/encrypt options
// import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';
// import { fileURLToPath } from 'url';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

export const readFromFileIfItExists = (filename) => {
	let data;
	try {
		data = fs.readFileSync(filename);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
	return data;
};

const decryptedOptionsFilename = filename => `${filename}.options.json`;

const decryptedContentFilename = filename => `${filename}.content.bin`;

const MAIN_SUBFILES = [
	{ key: 'video', filename: filename => `${filename}.video.moflex` },
	{ key: 'thumbnail', filename: filename => `${filename}.thumb.jpg` }
];

const AD_SUBFILES = [
	{ key: 'image', filename: (filename, index) => `${filename}.ad${index + 1}.jpg` }
];

export const metadataFilename = filename => `${filename}.meta.json`;

const readSubfiles = ({ subfileSpecs, filenameFunctionParams }) => {
	const subfiles = {};
	for (const { key: subfileKey, filename: subfilenameFunction } of subfileSpecs) {
		const subfilename = subfilenameFunction(...filenameFunctionParams);
		const subfileData = readFromFileIfItExists(subfilename);
		subfiles[subfileKey] = subfileData;
	}
	return subfiles;
};

const userApprovesOverwrite = (filenames, description, yOverride) => {
	if (yOverride) {
		return true;
	}

	const filesToBeOverwritten = filenames.filter(filename => fs.existsSync(filename));
	const filesToBeOverwrittenCount = filesToBeOverwritten.length;

	return filesToBeOverwrittenCount
		? keyInYN(`WARNING: The following ${description ? `${description} ` : ''}file${filesToBeOverwrittenCount === 1 ? '' : 's'} will be overwritten:${filesToBeOverwritten.map(filename => `\n\t${filename}`).join('')}\nIs this OK? (this can be overridden with the "-y" or "--yes-overwrite" option)`)
		: true;
};

const generateCommand = ({
	// program,
	name,
	description,
	argumentIsSource,
	requiresKey,
	fn
}) => (requiresKey
		? command => command
			.requiredOption('-k, --boss-aes-key <key>', 'BOSS AES key')
		: command => command
	)(program
		.command(name.replaceAll(' ', '-'))
		.description(description)
		.option('-y, --yes-overwrite', `yes, overwrite file${argumentIsSource ? 's' : ''}`))
	.argument(...(argumentIsSource
		? ['<source>', `file to ${name} from`]
		: ['<destination>', `file to ${name} to`]))
	.action(fn);

generateCommand({
	name: 'extract',
	description: 'extract description',
	argumentIsSource: true,
	fn: (inFilePath, { yesOverwrite }) => {
		const outFilePath = inFilePath;
		const inFileData = fs.readFileSync(inFilePath);
		const { metadata, mainSubfiles, adsSubfiles, dataSectionOddities } = extractDecrypted(inFileData);
		if (dataSectionOddities) {
			console.warn(dataSectionOddities);
		}

		const filesToWrite = {};
		filesToWrite[metadataFilename(outFilePath)] = JSON.stringify(metadata, null, '\t');
		MAIN_SUBFILES.forEach(({ key, filename }) => filesToWrite[filename(outFilePath)] = mainSubfiles[key]);
		adsSubfiles.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => filesToWrite[filename(outFilePath, i)] = adSubfiles[key]));
		if (userApprovesOverwrite(Object.keys(filesToWrite), 'extracted', yesOverwrite)) {
			Object.entries(filesToWrite).forEach(value => fs.writeFileSync(...value));
		}
	}
});

generateCommand({
	name: 'rebuild',
	description: 'rebuild description',
	argumentIsSource: false,
	fn: (outFilePath, { yesOverwrite }) => {
		let metadataHasSyntaxErrors = false;

		const outMetadataFilename = metadataFilename(outFilePath);
		const metadataData = readFromFileIfItExists(outMetadataFilename);
		let metadata;

		if (metadataData === undefined) {
			console.error(`The following file was not found:\n\t${outMetadataFilename}`);
		} else {
			try {
				metadata = JSON.parse(metadataData);
			} catch (jsonParseError) {
				if (isType(jsonParseError, SyntaxError)) {
					metadataHasSyntaxErrors = true;
				} else {
					throw jsonParseError;
				}
			}
		}

		const mainSubfiles = readSubfiles({
			subfileSpecs: MAIN_SUBFILES,
			filenameFunctionParams: [outFilePath]
		});

		const adsSubfiles = [...Array(metadata?.ads?.length ?? 0).keys().map(i => readSubfiles({
			subfileSpecs: AD_SUBFILES,
			filenameFunctionParams: [outFilePath, i]
		}))];

		if (metadataHasSyntaxErrors) {
			console.error(`The following file has JSON syntax errors:\n\t${outMetadataFilename}`);
		} else {
			let builtBuffer;
			try {
				builtBuffer = rebuildDecrypted({ metadata, mainSubfiles, adsSubfiles });
			} catch (error) {
				console.error(error.message);
			}
			if (builtBuffer && userApprovesOverwrite([outFilePath], 'decrypted', yesOverwrite)) {
				fs.writeFileSync(outFilePath, builtBuffer);
			}
		}
	}
});

program
	.parse(process.argv);
