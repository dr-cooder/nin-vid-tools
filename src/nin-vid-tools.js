#!/usr/bin/env node

import fs from 'fs';
import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';
// import path from 'path';
import { program } from 'commander';
import { spawn } from 'child_process';
import { keyInYN } from 'readline-sync';
import { extract } from './extract.js';
import { rebuild } from './rebuild.js';
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
	description: 'extract description', // TODO: Write better descriptions for these commands
	argumentIsSource: true,
	fn: (inFilePath, { yesOverwrite }) => {
		const inFileData = fs.readFileSync(inFilePath);
		const { metadata, mainSubfiles, adsSubfiles, dataSectionOddities } = extract(inFileData);
		if (dataSectionOddities) {
			console.warn(dataSectionOddities);
		}

		const fileDict = {};
		fileDict[metadataFilename(inFilePath)] = stringifyWithTabIndent(metadata);
		MAIN_SUBFILES.forEach(({ key, filename }) => fileDict[filename(inFilePath)] = mainSubfiles[key]);
		adsSubfiles.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fileDict[filename(inFilePath, i)] = adSubfiles[key]));
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
				fileDict: { [outFilePath]: rebuild({ metadata, mainSubfiles, adsSubfiles }) },
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
	.command('convert')
	.description('convert moflex using FFmpeg, auto-detecting 3D format and reformatting as side-by-side if applicable')
	.option('-3, --is-3d', 'video is 3D (this program will be able to auto-detect this in the future)')
	.option('-h, --half', 'if the video is 3D, convert to Half 3D format')
	.option('-v, --over-under', 'if the video is 3D, convert to OU instead of SBS')
	.option('-s, --swap', 'if the video is 3D, swap positions of L and R images')
	.argument('[input]', 'moflex file to be converted')
	.argument('[additional-ffmpeg-options...]', 'FFmpeg options, the last of which must be the output filename') // TODO: Make these optional; if there are none, simply print the 3D format
	.action((inFilePath, additionalFFmpegOptions, { is3d, half, overUnder, swap }) => {
		// TODO: Auto-detect 3D with the following pseudocode
		/*
		Start cursor at 0xE
		Begin loop
			Read two variable-length uInts (for up to 4 bytes, concatenate each group of 7 lowest-order bits until the highest-order bit is 0) and store them as "type" and "size"
			Switch on "type":
				0:
					Skip ahead "size" bytes
				2:
					Skip ahead 6 bytes
				4:
					Skip ahead 2 bytes
				1 or 3:
					Skip ahead 2 bytes
					Store the following uInt16BE's:
						Frame rate numerator
						Frame rate denominator
						Width
						Height
					Skip ahead 2 bytes
					Store the current byte as 3D format:
						0: 3D Interleave, Left First
						1: 3D Interleave, Right First
						2: 3D Top-To-Bottom, Left First
						3: 3D Top-To-Bottom, Right First
						4: 3D Side-By-Side, Left First
						5: 3D Side-By-Side, Right First
						6: 2D
					Break out of loop
		End loop
		References:
		https://code.ffmpeg.org/FFmpeg/FFmpeg/src/branch/release/4.4/libavformat/moflex.c
		https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveDemux.cs
		https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveStreamVideoWithLayout.cs
		*/
		spawn('ffmpeg', [
			'-i',
			inFilePath,
			...(is3d
				? [
					'-filter_complex',
					`[0:v]select=mod(n+1\\,2)[vl];[0:v]select=mod(n\\,2)[vr];${swap ? '[vr][vl]' : '[vl][vr]'}${overUnder ? 'v' : 'h'}stack=2[stacked];[stacked]select=mod(n+1\\,2)${half ? `[selected];[selected]setsar=${overUnder ? '2' : '0.5'}` : ''}[out]`,
					'-map',
					'[out]:0',
					'-map',
					'0:a'
				]
				: []),
			...additionalFFmpegOptions
		], { stdio: 'inherit' });
	});

program
	.parse(process.argv);
