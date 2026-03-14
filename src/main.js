#!/usr/bin/env node
// TODO: Rename this file to "nin-vid-tools.js" and export "extraction.js" and "rebuilding.js"

import fs from 'fs';
import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';
// import path from 'path';
import { program } from 'commander';
import { keyInYN } from 'readline-sync';
import { extractDecrypted } from './extraction.js';
import { rebuildDecrypted } from './rebuilding.js';
import {
	isType,
	flattenObject,
	unflattenObject,
	uIntToBufferString,
	isOrAre,
	tabbedLines
} from './helpers.js';

process.loadEnvFile();
const { BOSS_AES_KEY } = process.env;
const finalizeBossAesKey = bossAesKey => bossAesKey ?? BOSS_AES_KEY;
// import { fileURLToPath } from 'url';
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

const stringifyWithTabIndent = data => JSON.stringify(data, null, '\t');

const readFromFileIfItExists = (filename) => {
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

const parseJSONSafely = (data) => {
	let parsed;
	try {
		parsed = JSON.parse(data);
	} catch (jsonParseError) {
		if (!isType(jsonParseError, SyntaxError)) {
			throw jsonParseError;
		}
	}
	return parsed;
};

const optionsFilename = filename => `${filename}.options.json`;

const contentFilename = filename => `${filename}.content.bin`;

const metadataFilename = filename => `${filename}.meta.json`;

const MAIN_SUBFILES = [
	{ key: 'video', filename: filename => `${filename}.video.moflex` },
	{ key: 'thumbnail', filename: filename => `${filename}.thumb.jpg` }
];

const AD_SUBFILES = [
	{ key: 'image', filename: (filename, index) => `${filename}.ad${index + 1}.jpg` }
];

const readSubfiles = ({ subfileSpecs, filenameFunctionParams }) => {
	const subfiles = {};
	for (const { key: subfileKey, filename: subfilenameFunction } of subfileSpecs) {
		const subfilename = subfilenameFunction(...filenameFunctionParams);
		const subfileData = readFromFileIfItExists(subfilename);
		subfiles[subfileKey] = subfileData;
	}
	return subfiles;
};

const writeFiles = ({ fileDict, description, yesOverwrite }) => {
	let canWriteFiles;
	if (yesOverwrite) {
		canWriteFiles = true;
	} else {
		const filesToBeOverwritten = Object.keys(fileDict).filter(filename => fs.existsSync(filename));
		const filesToBeOverwrittenCount = filesToBeOverwritten.length;
		canWriteFiles = filesToBeOverwrittenCount
			? keyInYN(`WARNING: The following ${description ? `${description} ` : ''}file${filesToBeOverwrittenCount === 1 ? '' : 's'} will be overwritten:${filesToBeOverwritten.map(filename => `\n\t${filename}`).join('')}\nIs this OK? (this can be overridden with the "-y" or "--yes-overwrite" option)`)
			: true;
	}
	if (canWriteFiles) {
		Object.entries(fileDict).forEach(value => fs.writeFileSync(...value));
	}
	return canWriteFiles;
};

const generateCommand = ({
	name,
	description,
	argumentIsSource,
	requiresKey,
	fn
}) => (requiresKey
		? command => command
			.option('-k, --boss-aes-key <key>', 'BOSS AES key') // Should not be required if .env variable is set up
		: command => command
	)(program
		.command(name.replaceAll(' ', '-'))
		.description(description ?? '')
		.option('-y, --yes-overwrite', `yes, overwrite file${argumentIsSource ? 's' : ''}`))
	.argument(...(argumentIsSource
		? ['<source>', `file to ${name} from`]
		: ['<destination>', `file to ${name} to`]))
	.action((...fnArgs) => {
		try {
			fn(...fnArgs);
		} catch (error) {
			console.error(error.message);
		}
	});

generateCommand({
	name: 'extract',
	description: 'extract description', // TODO: Write better descriptions for, and document, these commands
	argumentIsSource: true,
	fn: (inFilePath, { yesOverwrite }) => {
		const outFilePath = inFilePath;
		const inFileData = fs.readFileSync(inFilePath);
		const { metadata, mainSubfiles, adsSubfiles, dataSectionOddities } = extractDecrypted(inFileData);
		if (dataSectionOddities) {
			console.warn(dataSectionOddities);
		}

		const fileDict = {};
		fileDict[metadataFilename(outFilePath)] = stringifyWithTabIndent(metadata);
		MAIN_SUBFILES.forEach(({ key, filename }) => fileDict[filename(outFilePath)] = mainSubfiles[key]);
		adsSubfiles.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fileDict[filename(outFilePath, i)] = adSubfiles[key]));
		writeFiles({ fileDict, description: 'extracted', yesOverwrite });
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
			throw new Error('The metadata file was not found');
		} else {
			metadata = parseJSONSafely(metadataData);
			metadataHasSyntaxErrors = metadata === undefined;
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
			throw new SyntaxError('The metadata file has JSON syntax errors');
		} else {
			writeFiles({
				fileDict: { [outFilePath]: rebuildDecrypted({ metadata, mainSubfiles, adsSubfiles }) },
				description: 'rebuilt',
				yesOverwrite
			});
		}
	}
});

generateCommand({
	name: 'decrypt',
	description: 'decrypt description',
	argumentIsSource: true,
	requiresKey: true,
	fn: (inFilePath, { yesOverwrite, bossAesKey }) => {
		const decryption = decrypt3DS(inFilePath, finalizeBossAesKey(bossAesKey));
		delete decryption.hash_type;
		const payloadContents0 = decryption.payload_contents[0];
		const { content } = payloadContents0;
		decryption.options = payloadContents0;
		delete decryption.payload_contents;
		writeFiles({
			fileDict: {
				[optionsFilename(inFilePath)]: stringifyWithTabIndent(unflattenObject(Object.fromEntries(
					Object.entries(flattenObject(decryption))
						.filter(([, value]) => !isType(value, Buffer))
						.map(([key, value]) => isType(value, BigInt) ? [key, uIntToBufferString({ uInt: value, format: '64BE' })] : [key, value])
				))),
				[contentFilename(inFilePath)]: content
			},
			description: 'decrypted',
			yesOverwrite
		});
	}
});

generateCommand({
	name: 'encrypt',
	description: 'encrypt description',
	argumentIsSource: false,
	requiresKey: true,
	fn: (outFilePath, { yesOverwrite, bossAesKey }) => {
		const missingFiles = [];
		const files = {};
		for (const { filenameFunction, description } of [
			{
				filenameFunction: optionsFilename,
				description: 'Options'
			},
			{
				filenameFunction: contentFilename,
				description: 'Content'
			}
		]) {
			const fileData = readFromFileIfItExists(filenameFunction(outFilePath));
			if (fileData === undefined) {
				missingFiles.push(description);
			} else {
				files[description.toLowerCase()] = fileData;
			}
		}
		const { options: optionsOuterData, content } = files;
		const optionsOuterUnmodified = parseJSONSafely(optionsOuterData);
		const optionsHasSyntaxErrors = optionsOuterData && optionsOuterUnmodified === undefined;
		const optionsOuterFlat = !optionsHasSyntaxErrors && flattenObject(optionsOuterUnmodified);
		const invalidOptions = [];
		if (optionsOuterFlat) {
			for (const [keyBeingTested, shouldBeBigInt] of [
				['serial_number', true],
				['flags', true],
				['options.program_id', true],
				['options.content_datatype', false],
				['options.ns_data_id', false],
				['options.version', false]
			]) {
				const valueBeingTested = optionsOuterFlat[keyBeingTested];
				if (shouldBeBigInt
					? isType(valueBeingTested, String) && /^[0-9a-f]{16}$/i.test(valueBeingTested)
					: isType(valueBeingTested, Number)
				) {
					if (shouldBeBigInt) {
						optionsOuterFlat[keyBeingTested] = Buffer.from(valueBeingTested, 'hex').readBigUInt64BE();
					}
				} else {
					invalidOptions.push(keyBeingTested);
				}
			}
		}
		const invalidOptionCount = invalidOptions.length;
		const missingFileCount = missingFiles.length;
		if (missingFileCount || optionsHasSyntaxErrors || invalidOptionCount) {
			throw new Error([
				...(missingFileCount ? [`The following file${isOrAre(missingFileCount)} missing:${tabbedLines(missingFiles)}`] : []),
				...(optionsHasSyntaxErrors ? ['The options file has JSON syntax errors'] : []),
				...(invalidOptionCount ? [`The following option key${isOrAre(missingFileCount)} missing or of the wrong data type:${tabbedLines(invalidOptions)}`] : [])
			].join('\n'));
		}
		const { serial_number: serialNumber, flags, options } = unflattenObject(optionsOuterFlat);
		options.content = content;
		writeFiles({
			fileDict: {
				[outFilePath]: encrypt3DS(finalizeBossAesKey(bossAesKey), serialNumber, [options], flags)
			},
			description: 'encrypted',
			yesOverwrite
		});
	}
});

// TODO: these two-in-one commands
/*
generateCommand({
	name: 'decrypt and extract',
	argumentIsSource: true,
	requiresKey: true
	fn: () => {
		const content = Buffer.from('Hello World');
		const encrypted = encrypt3DS(BOSS_3DS_AES_KEY, 1692231927n, {
			program_id: 0x0004001000022900, // can also be named "title_id"
			content_datatype: 65537,
			ns_data_id: 36,
			version: 1,
			content,
		});

		fs.writeFileSync(__dirname + '/hello-world.boss', encrypted);
	}
});

generateCommand({
	name: 'rebuild and encrypt',
	argumentIsSource: false,
	requiresKey: true
});
*/

program
	.parse(process.argv);
