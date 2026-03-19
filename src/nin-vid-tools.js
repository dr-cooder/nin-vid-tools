#!/usr/bin/env node

import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';
import { program } from 'commander';
import { keyInYN } from 'readline-sync';
import { extract } from '#extract';
import {
	isType,
	flattenObject,
	unflattenObject,
	uIntToBufferString,
	isOrAre,
	tabbedLines
} from '#helpers';
import { rebuild } from '#rebuild';

const finalizeBossAesKey = (bossAesKey) => {
	let finalizedBossAesKey = bossAesKey;
	if (finalizedBossAesKey === undefined) {
		process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env'));
		finalizedBossAesKey = process.env.BOSS_AES_KEY;
	}
	return finalizedBossAesKey;
};

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

const BOSS_STATES = {
	encrypted: 'encrypted',
	decrypted: 'decrypted',
	extracted: 'extracted'
};

const generateDescription = ({ missingState, awayFromBOSS }) => {
	const missingStateIsEncrypted = missingState === BOSS_STATES.encrypted;
	const missingStateIsExtracted = missingState === BOSS_STATES.extracted;
	const nearStepState = missingStateIsEncrypted ? BOSS_STATES.decrypted : BOSS_STATES.encrypted;
	const farStepState = missingStateIsExtracted ? BOSS_STATES.decrypted : BOSS_STATES.extracted;
	const farStepFilenames = [
		...(missingStateIsEncrypted ? [] : [optionsFilename]),
		...(missingStateIsExtracted ? [contentFilename] : [metadataFilename, ...MAIN_SUBFILES.map(({ filename }) => filename), ...AD_SUBFILES.map(({ filename }) => val => `${filename(val, 0)} (, ${filename(val, 1)}, ...)`)]) // .map(missingStateIsEncrypted ? fn => fn : fn => val => fn(contentFilename(val)))
	];
	const nearStepText = filename => `${nearStepState}:${tabbedLines([filename])}`;
	const farStepText = filename => `${farStepState}:${tabbedLines(farStepFilenames.map(fn => fn(filename)))}`;
	return `\nconvert from ${(awayFromBOSS ? nearStepText : farStepText)('<source>')}\nto ${(awayFromBOSS ? farStepText : nearStepText)('[destination]')}\n`;
};

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
			? keyInYN(`WARNING: The following ${description ? `${description} ` : ''}file${filesToBeOverwrittenCount === 1 ? '' : 's'} will be overwritten:${filesToBeOverwritten.map(filename => `\n\t${filename}`).join('')}\nIs this OK? (this warning can be suppressed with the "-y" or "--yes-overwrite" option)`)
			: true;
	}
	if (canWriteFiles) {
		Object.entries(fileDict).forEach(value => fs.writeFileSync(...value));
	}
	return canWriteFiles;
};

const nameOfFilesDescription = multiple => multiple ? 'base name of files' : 'name of file';

const generateCommand = ({
	name,
	missingState,
	awayFromBOSS,
	requiresKey,
	fn
}) => (requiresKey
		? command => command
			.option('-k, --boss-aes-key <key>', 'BOSS AES key (not required if specified in .env)') // Should not be required if .env variable is set up
		: command => command
	)(program
		.command(name.replaceAll(' ', '-'))
		.description(generateDescription({ missingState, awayFromBOSS }))
		.option('-y, --yes-overwrite', `yes, overwrite file${awayFromBOSS ? 's' : ''}`))
	.argument('<source>', `${nameOfFilesDescription(!awayFromBOSS)} to ${name} from`)
	.argument('[destination]', `${nameOfFilesDescription(awayFromBOSS)} to ${name} to (same as source if unspecified)`)
	.action((source, destination, options) => {
		try {
			fn(source, destination ?? source, options);
		} catch (error) {
			console.error(error.message);
		}
	});

const decryptCommandStep = (pathOrBuffer, bossAesKey) => {
	const decryption = decrypt3DS(pathOrBuffer, finalizeBossAesKey(bossAesKey));
	delete decryption.hash_type;
	const payloadContents0 = decryption.payload_contents[0];
	const { content } = payloadContents0;
	decryption.options = payloadContents0;
	delete decryption.payload_contents;
	return {
		options: stringifyWithTabIndent(unflattenObject(Object.fromEntries(
			Object.entries(flattenObject(decryption))
				.filter(([, value]) => !isType(value, Buffer))
				.map(([key, value]) => isType(value, BigInt) ? [key, uIntToBufferString({ uInt: value, format: '64BE' })] : [key, value])
		))),
		content
	};
};

const extractCommandStep = ({
	contentFilenameAndContent: [baseFilename, content],
	yesOverwrite,
	optionsFilenameAndContent
}) => {
	const { metadata, mainSubfiles, adsSubfiles, dataSectionOddities } = extract(content);
	if (dataSectionOddities) {
		console.warn(dataSectionOddities);
	}

	const fileDict = optionsFilenameAndContent ? Object.fromEntries([optionsFilenameAndContent]) : {};
	fileDict[metadataFilename(baseFilename)] = stringifyWithTabIndent(metadata);
	MAIN_SUBFILES.forEach(({ key, filename }) => fileDict[filename(baseFilename)] = mainSubfiles[key]);
	adsSubfiles.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fileDict[filename(baseFilename, i)] = adSubfiles[key]));
	writeFiles({ fileDict, description: optionsFilenameAndContent ? 'decrypted and extracted' : 'extracted', yesOverwrite });
};

const rebuildCommandStep = (sourceBase) => {
	let metadataHasSyntaxErrors = false;

	const outMetadataFilename = metadataFilename(sourceBase);
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
		filenameFunctionParams: [sourceBase]
	});

	const adsSubfiles = [...Array(metadata?.ads?.length ?? 0).keys().map(i => readSubfiles({
		subfileSpecs: AD_SUBFILES,
		filenameFunctionParams: [sourceBase, i]
	}))];

	if (metadataHasSyntaxErrors) {
		throw new SyntaxError('The metadata file has JSON syntax errors');
	} else {
		return rebuild({ metadata, mainSubfiles, adsSubfiles });
	}
};

const encryptCommandStep = ({
	bossAesKey,
	files: { options: optionsOuterData, content },
	destination,
	yesOverwrite,
	additionalErrors,
	rebuilt
}) => {
	const optionsOuterUnmodified = parseJSONSafely(optionsOuterData);
	const optionsHasSyntaxErrors = optionsOuterData && optionsOuterUnmodified === undefined;
	const optionsOuterFlat = optionsOuterUnmodified && flattenObject(optionsOuterUnmodified);
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
	if (additionalErrors || optionsHasSyntaxErrors || invalidOptionCount) {
		throw new Error([
			...(additionalErrors ? [additionalErrors] : []),
			...(optionsHasSyntaxErrors ? ['The options file has JSON syntax errors'] : []),
			...(invalidOptionCount ? [`The following option key${isOrAre(invalidOptionCount)} missing or of the wrong data type:${tabbedLines(invalidOptions)}`] : [])
		].join('\n'));
	}
	const { serial_number: serialNumber, flags, options } = unflattenObject(optionsOuterFlat);
	options.content = content;
	writeFiles({
		fileDict: {
			[destination]: encrypt3DS(finalizeBossAesKey(bossAesKey), serialNumber, [options], flags)
		},
		description: rebuilt ? 'rebuilt and encrypted' : 'encrypted',
		yesOverwrite
	});
};

generateCommand({
	name: 'decrypt and extract',
	missingState: BOSS_STATES.decrypted,
	awayFromBOSS: true,
	requiresKey: true,
	fn: (source, destination, { yesOverwrite, bossAesKey }) => {
		const { options, content } = decryptCommandStep(source, bossAesKey);
		extractCommandStep({
			contentFilenameAndContent: [destination, content],
			yesOverwrite,
			optionsFilenameAndContent: [optionsFilename(destination), options]
		});
	}
});

generateCommand({
	name: 'decrypt',
	missingState: BOSS_STATES.extracted,
	awayFromBOSS: true,
	requiresKey: true,
	fn: (source, destination, { yesOverwrite, bossAesKey }) => {
		const { options, content } = decryptCommandStep(source, bossAesKey);
		writeFiles({
			fileDict: {
				[optionsFilename(destination)]: options,
				[contentFilename(destination)]: content
			},
			description: 'decrypted',
			yesOverwrite
		});
	}
});

generateCommand({
	name: 'extract',
	missingState: BOSS_STATES.encrypted,
	awayFromBOSS: true,
	fn: (source, destination, { yesOverwrite }) => extractCommandStep({
		contentFilenameAndContent: [destination, fs.readFileSync(source)],
		yesOverwrite
	})
});

generateCommand({
	name: 'rebuild and encrypt',
	missingState: BOSS_STATES.decrypted,
	awayFromBOSS: false,
	requiresKey: true,
	fn: (source, destination, { yesOverwrite, bossAesKey }) => {
		const options = readFromFileIfItExists(optionsFilename(source));
		const additionalErrors = options === undefined ? ['The options file is missing'] : [];
		let content;
		try {
			content = rebuildCommandStep(source);
		} catch (error) {
			additionalErrors.push(error.message);
		}
		encryptCommandStep({
			bossAesKey,
			files: {
				options,
				content
			},
			destination,
			yesOverwrite,
			additionalErrors: additionalErrors.join('\n'),
			rebuilt: true
		});
	}
});

generateCommand({
	name: 'rebuild',
	missingState: BOSS_STATES.encrypted,
	awayFromBOSS: false,
	fn: (source, destination, { yesOverwrite }) => {
		writeFiles({
			fileDict: { [destination]: rebuildCommandStep(source) },
			description: 'rebuilt',
			yesOverwrite
		});
	}
});

generateCommand({
	name: 'encrypt',
	missingState: BOSS_STATES.extracted,
	awayFromBOSS: false,
	requiresKey: true,
	fn: (source, destination, { yesOverwrite, bossAesKey }) => {
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
			const fileData = readFromFileIfItExists(filenameFunction(source));
			if (fileData === undefined) {
				missingFiles.push(description);
			} else {
				files[description.toLowerCase()] = fileData;
			}
		}
		const missingFileCount = missingFiles.length;
		encryptCommandStep({
			bossAesKey,
			files,
			destination,
			yesOverwrite,
			additionalErrors: missingFileCount && `The following file${isOrAre(missingFileCount)} missing:${tabbedLines(missingFiles)}`
		});
	}
});

const readVariableUInts = (buffer, cursor, count = 1) => {
	const uInts = [];
	for (let i = 0; i < count; i++) {
		let uInt = 0;
		for (let j = 0; j < 4; j++) {
			uInt <<= 7;
			const currentByte = buffer[cursor];
			cursor++;
			uInt += currentByte & 0x7F;
			if (!(currentByte & 0x80)) {
				break;
			}
		}
		uInts[i] = uInt;
	}
	return { uInts, cursor };
};

program
	.command('convert')
	.description('convert MOFLEX using FFmpeg, auto-detecting 3D format and reformatting as full side-by-side by default if applicable')
	.option('-h, --half', 'if the video is 3D, convert to Half 3D format')
	.option('-v, --over-under', 'if the video is 3D, convert to OU instead of SBS')
	.option('-s, --swap', 'if the video is 3D, swap positions of L and R images')
	.argument('[input]', 'MOFLEX file to be converted')
	.argument('[additional-ffmpeg-options...]', 'FFmpeg options, the last of which must be the output filename')
	.action((inFilePath, additionalFFmpegOptions, { half, overUnder, swap = false }) => {
		// https://code.ffmpeg.org/FFmpeg/FFmpeg/src/branch/release/4.4/libavformat/moflex.c
		// https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveDemux.cs
		// https://github.com/Gericom/MobiclipDecoder/blob/c88b67d3cca93de03d286f67f01ee40da605f5ae/LibMobiclip/Containers/Moflex/MoLiveStreamVideoWithLayout.cs
		const inFileData = fs.readFileSync(inFilePath);
		let cursor = 0xE;
		let videoStreamReached;
		while (cursor < inFileData.length) {
			const { uInts: [type, size], cursor: cursorAfterTypeAndSize } = readVariableUInts(inFileData, cursor, 2);
			cursor = cursorAfterTypeAndSize;
			switch (type) {
				case 0:
					cursor += size;
					break;
				case 2:
					cursor += 6;
					break;
				case 4:
					cursor += 2;
					break;
				case 1:
				case 3:
					cursor += 2;
					videoStreamReached = type;
					break;
				default:
					throw new Error(`Unknown MOFLEX stream type: ${type}`);
			}
			if (videoStreamReached) {
				break;
			}
		}
		const fpsNumerator = inFileData.readUInt16BE(cursor);
		const fpsDenominator = inFileData.readUInt16BE(cursor + 0x2);
		const width = inFileData.readUInt16BE(cursor + 0x4);
		const height = inFileData.readUInt16BE(cursor + 0x6);
		const formatOf3D = videoStreamReached === 3 ? inFileData.readUInt8(cursor + 0xA) : 6;
		const formatOf3DIsSwapped = !!(formatOf3D % 2);
		const formatOf3DSupercategory = Math.floor(formatOf3D / 2);
		const formatOf3DIsInterleave = formatOf3DSupercategory === 0;
		const fpsDenominatorFinal = fpsDenominator * (formatOf3DIsInterleave ? 2 : 1);
		console.log(`${[
			'3D Interleave, Left First',
			'3D Interleave, Right First',
			// TODO: Get MOFLEX files in these stacked formats and verify that they are Full
			'3D Top-To-Bottom, Left First',
			'3D Top-To-Bottom, Right First',
			'3D Side-By-Side, Left First',
			'3D Side-By-Side, Right First',
			'2D'
		][formatOf3D]}, ${width}x${height}, ${fpsNumerator / fpsDenominatorFinal}fps`);
		if (formatOf3D > 6) {
			throw new Error(`Unknown 3D format: ${formatOf3D}`);
		}
		if (additionalFFmpegOptions.length) {
			spawn('ffmpeg', [
				'-i',
				inFilePath,
				...(formatOf3DSupercategory === 3
					? []
					: [
						'-filter_complex',
						`${[
							'[0:v]select=mod(n+1\\,2)[vl];[0:v]select=mod(n\\,2)[vr]',
							'[0:v]crop=iw/2:ih:0:0[vl];[0:v]crop=iw/2:ih:ow:0[vr]',
							'[0:v]crop=iw:ih/2:0:0[vl];[0:v]crop=iw:ih/2:0:oh[vr]'
						][formatOf3DSupercategory]};${formatOf3DIsSwapped === swap ? '[vl][vr]' : '[vr][vl]'}${overUnder ? 'v' : 'h'}stack=2${half ? `[stacked];[stacked]setsar=${overUnder ? '2' : '0.5'}` : ''}[out]`,
						...(formatOf3DIsInterleave
							? [
								'-r',
								`${fpsNumerator}/${fpsDenominatorFinal}`
							]
							: []
						),
						'-map',
						'[out]:0',
						'-map',
						'0:a'
					]
				),
				...additionalFFmpegOptions
			], { stdio: 'inherit' });
		}
	});

program
	.parse(process.argv);
