#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
// import { fileURLToPath } from 'url';
import {
	UINT_LENGTHS,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	metadataFilename,
	MAIN_SUBFILES,
	AD_SUBFILES
} from './constants.js';
import {
	getValue,
	setValue,
	arrayOfEmptyObjects,
	readFromFileIfItExists,
	isType,
	userApprovesOverwrite
} from './helpers.js';
// import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';

// --- EXTRACTION ---
// TODO: Move to a separate "extraction.js"

const readDataSection = (buffer, cursor, { type, length, format, key, until }) => ({
	type, key, until, format, ...(isType(length, Number) // Only subfiles have variable length, not metadata
		? { value: buffer.subarray(cursor, cursor + length).toString(format).replace(/[\0]+$/, ''), length }
		: (format == null ? { length } : { value: buffer[`readUint${format}`](cursor), length: UINT_LENGTHS[format] }))
});

const extractFromBuffer = ({ buffer, dataSections, offsets, metadata, subfiles }) => { // TODO: make this a pure function; don't mutate the last 3 params
	let adCount;
	let adsOffsets;
	let cursor = 0;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey,
			until: dataSectionUntil,
			value: dataSectionValue,
			length: dataSectionLength
		} = readDataSection(buffer, cursor, dataSection);
		const cursorAfterOffset = cursor + offsets[dataSectionLength];
		const untilOffset = dataSectionType === 'leftoverData'
			? (dataSectionUntil == null
				? (adCount
					? adsOffsets[0].fileStartToAdStart
					: buffer.length)
				: offsets[dataSectionUntil])
			: undefined;
		switch (dataSectionType) {
			case 'offset':
				offsets[dataSectionKey] = dataSectionValue;
				cursor += dataSectionLength;
				break;
			case 'meta':
				setValue(metadata, dataSectionKey, dataSectionValue);
				cursor += dataSectionLength;
				break;
			case 'adCount':
				adCount = dataSectionValue;
				metadata.ads = arrayOfEmptyObjects(adCount);
				subfiles.ads = arrayOfEmptyObjects(adCount);
				adsOffsets = arrayOfEmptyObjects(adCount);
				cursor += dataSectionLength;
				break;
			case 'adOffsets':
				for (let i = 0; i < adCount; i++) {
					adsOffsets[i][dataSectionKey] = i ? readDataSection(buffer, cursor, dataSection).value : dataSectionValue;
					cursor += dataSectionLength;
				}
				break;
			case 'adMetas':
				for (let i = 0; i < adCount; i++) {
					setValue(metadata.ads[i], dataSectionKey, i ? readDataSection(buffer, cursor, dataSection).value : dataSectionValue);
					cursor += dataSectionLength;
				}
				break;
			case 'subfile':
				subfiles[dataSectionKey] = buffer.subarray(cursor, cursorAfterOffset);
				cursor = cursorAfterOffset;
				break;
			case 'leftoverData':
				if (untilOffset < cursor) {
					throw new Error(`"until" prop of "${dataSectionKey}" (${dataSectionUntil == null ? 'start of first ad' : `"${dataSectionUntil}"`}, which is ${untilOffset}) is before the cursor (${cursor})!`);
				}
				setValue(metadata, dataSectionKey, buffer.subarray(cursor, untilOffset).toString('hex'));
				cursor = untilOffset;
				break;
			default:
				throw new Error(`"${dataSectionType}" is not a valid data section type!`);
		}
	}

	return { adCount, adsOffsets };
};

const extractDecrypted = (inFileDataDecrypted) => {
	const offsets = {};
	const metadata = {};
	const subfiles = {};

	const { adCount, adsOffsets } = extractFromBuffer({
		buffer: inFileDataDecrypted,
		dataSections: MAIN_DATA_SECTIONS,
		offsets,
		metadata,
		subfiles
	});

	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const adOffsets = adsOffsets[adIndex];
		const adMetadata = metadata.ads[adIndex];
		const adSubfiles = subfiles.ads[adIndex];
		const nextAdIndex = adIndex + 1;
		extractFromBuffer({
			buffer: inFileDataDecrypted.subarray(
				adOffsets.fileStartToAdStart,
				nextAdIndex == adCount
					? inFileDataDecrypted.length
					: adsOffsets[nextAdIndex].fileStartToAdStart
				),
			dataSections: AD_DATA_SECTIONS,
			offsets: adOffsets,
			metadata: adMetadata,
			subfiles: adSubfiles
		});
	}

	return { metadata, subfiles };
};

// --- REBUILDING ---
// TODO: Move to a separate "rebuilding.js"

const readSubfiles = ({ subfileSpecs, filenameFunctionParams, missingSubfilenameCallback }) => {
	const subfiles = {};
	for (const { key: subfileKey, filename: subfilenameFunction } of subfileSpecs) {
		const subfilename = subfilenameFunction(...filenameFunctionParams);
		const subfileData = readFromFileIfItExists(subfilename);
		if (subfileData === undefined) {
			missingSubfilenameCallback(subfilename);
		} else {
			subfiles[subfileKey] = subfileData;
		}
	}
	return subfiles;
};

const getOffsetsAndEnd = ({ dataSections, metadata, subfiles, adCount }) => {
	const offsets = {};
	let cursor = 0;
	let end;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			format: dataSectionFormat,
			length: dataSectionLength,
			key: dataSectionKey,
			until: dataSectionUntil
		} = dataSection;
		const dataSectionActualLength = isType(dataSectionLength, Number) ? dataSectionLength : UINT_LENGTHS[dataSectionFormat];
		const dataSectionValue = getValue(metadata, dataSectionKey);
		const untilOffset = cursor + Buffer.from(dataSectionValue, String).length;
		switch (dataSectionType) {
			case 'subfile':
				offsets[dataSectionLength] = subfiles[dataSectionKey]?.length ?? 0;
				cursor += offsets[dataSectionLength];
				break;
			case 'leftoverData':
				if (dataSectionUntil == null) {
					end = untilOffset;
				} else {
					offsets[dataSectionUntil] = untilOffset;
				}
				cursor = untilOffset;
				break;
			case 'adOffsets':
			case 'adMetas':
				cursor += dataSectionActualLength * adCount;
				break;
			default:
				cursor += dataSectionActualLength;
		}
	}

	return { offsets, end };
};

const writeDataSection = (buffer, cursor, value, { length, format }) => {
	if (value == null) {
		throw new Error('Nullish values cannot be written to buffers');
	}
	let offset = 0;
	if (isType(length, Number)) {
		Buffer.from(value, format).copy(buffer, cursor, 0, length); // This assumes it's already writing over 0x00's such that they may trail until length is reached
		offset = length;
	} else {
		buffer[`writeUint${format}`](value, cursor);
		offset = UINT_LENGTHS[format];
	}
	return offset;
};

// Here's where we accumulate missing keys
const rebuildToBuffer = ({ buffer, dataSections, mainOffsets, adsOffsets, metadata, subfiles }) => {
	const adsMeta = metadata.ads;
	const adCount = adsMeta?.length ?? 0;
	const invalidMetadataKeys = [];
	let cursor = 0;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey,
			until: dataSectionUntil
		} = dataSection;
		try {
			switch (dataSectionType) {
				case 'offset':
					cursor += writeDataSection(buffer, cursor, mainOffsets[dataSectionKey], dataSection);
					break;
				case 'meta':
					cursor += writeDataSection(buffer, cursor, getValue(metadata, dataSectionKey), dataSection);
					break;
				case 'adCount':
					cursor += writeDataSection(buffer, cursor, adCount, dataSection);
					break;
				case 'adOffsets':
					for (let i = 0; i < adCount; i++) {
						cursor += writeDataSection(buffer, cursor, adsOffsets[i][dataSectionKey], dataSection);
					}
					break;
				case 'adMetas':
					for (let i = 0; i < adCount; i++) {
						cursor += writeDataSection(buffer, cursor, getValue(adsMeta?.[i] ?? {}, dataSectionKey), dataSection);
					}
					break;
				case 'subfile':
					subfiles[dataSectionKey]?.copy(buffer, cursor);
					cursor += subfiles[dataSectionKey]?.length;
					break;
				case 'leftoverData':
					cursor += writeDataSection(buffer, cursor, getValue(metadata, dataSectionKey), { length: mainOffsets[dataSectionUntil] - cursor, format: 'hex' });
					break;
				default:
					throw new Error(`"${dataSectionType}" is not a valid data section type!`); // TODO: Don't catch this error
			}
		} catch (error) {
			invalidMetadataKeys.push(dataSectionKey);
		}
	}

	return invalidMetadataKeys;
};

const rebuildDecrypted = (outFilename, yOverride) => {
	const missingSubfilenames = [];
	const invalidMetadataKeys = [];
	let metadataHasSyntaxErrors = false;

	const outMetadataFilename = metadataFilename(outFilename);
	const metadataData = readFromFileIfItExists(outMetadataFilename);
	let metadata;
	let adsMetadata;
	let adCount;
	let adsSubfiles;

	if (metadataData === undefined) {
		missingSubfilenames.push(outMetadataFilename);
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
		adsMetadata = getValue(metadata, 'ads');
		if (isType(adsMetadata, Array)) {
			adCount = adsMetadata.length;
			adsSubfiles = [...Array(adCount).keys().map(i => readSubfiles({
				subfileSpecs: AD_SUBFILES,
				filenameFunctionParams: [outFilename, i],
				missingSubfilenameCallback: (subfilename) => {
					missingSubfilenames.push(subfilename);
				}
			}))];
		} else {
			invalidMetadataKeys.push('ads');
		}
	}

	const mainSubfiles = readSubfiles({
		subfileSpecs: MAIN_SUBFILES,
		filenameFunctionParams: [outFilename],
		missingSubfilenameCallback: (subfilename) => {
			missingSubfilenames.push(subfilename);
		}
	});

	const missingSubfileCount = missingSubfilenames.length;
	if (missingSubfileCount) {
		console.log(`The following file${missingSubfileCount === 1 ? ' is' : 's are'} missing:\n${missingSubfilenames.join('\n')}`);
	}

	if (metadataHasSyntaxErrors) {
		console.log(`The following file has JSON syntax errors:\n${outMetadataFilename}`);
	} else {
		const {
			offsets: mainOffsets,
			end: mainEnd
		} = getOffsetsAndEnd({
			dataSections: MAIN_DATA_SECTIONS,
			metadata,
			subfiles: mainSubfiles,
			adCount
		});
		const adsOffsets = [];
		let fullBufferLength = mainEnd;
		for (let adIndex = 0; adIndex < adCount; adIndex++) {
			const {
				offsets: adOffsets,
				end: adEnd
			} = getOffsetsAndEnd({
				dataSections: AD_DATA_SECTIONS,
				metadata: adsMetadata[adIndex],
				subfiles: adsSubfiles[adIndex]
			});
			adsOffsets[adIndex] = { ...adOffsets, fileStartToAdStart: fullBufferLength };
			fullBufferLength += adEnd;
		}
		const outBuffer = Buffer.alloc(fullBufferLength);
		invalidMetadataKeys.push(...rebuildToBuffer({
			buffer: outBuffer,
			dataSections: MAIN_DATA_SECTIONS,
			mainOffsets,
			adsOffsets,
			metadata,
			subfiles: mainSubfiles
		}));
		for (let adIndex = 0; adIndex < adCount; adIndex++) {
			const adOffsets = adsOffsets[adIndex];
			invalidMetadataKeys.push(...rebuildToBuffer({
				buffer: outBuffer.subarray(adOffsets.fileStartToAdStart),
				dataSections: AD_DATA_SECTIONS,
				mainOffsets: adOffsets,
				adsOffsets: [],
				metadata: adsMetadata[adIndex],
				subfiles: adsSubfiles[adIndex]
			}).map(invalidMetadataKey => `ads.${adIndex}.${invalidMetadataKey}`));
		}
		const invalidMetadataKeyCount = invalidMetadataKeys.length;
		if (invalidMetadataKeyCount) {
			console.log(`The following metadata key${invalidMetadataKeyCount === 1 ? ' is' : 's are'} missing or of the wrong data type:\n${invalidMetadataKeys.join('\n')}`);
		} else {
			// TODO: This function should simply return a buffer, with file writing taking place outside
			if (userApprovesOverwrite([outFilename], 'decrypted', yOverride)) {
				fs.writeFileSync(outFilename, outBuffer);
			}
		}
	}
};

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const __cwd = process.cwd();
if (process.argv.length <= 2) {
	throw new Error('Input file required');
}
const inFilePath = process.argv[2];
// console.log(inFilePath);
const inFilePathFull = path.join(__cwd, inFilePath);

// Uncomment these lines to extract
/*
const outFilePathFull = inFilePathFull;
const inFileData = fs.readFileSync(inFilePathFull);
const { metadata, subfiles } = extractDecrypted(inFileData);

fs.writeFileSync(metadataFilename(outFilePathFull), JSON.stringify(metadata, null, '\t')); // TODO: Alphabetize?
MAIN_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull), subfiles[key]));
subfiles.ads.forEach((adSubfiles, i) => AD_SUBFILES.forEach(({ key, filename }) => fs.writeFileSync(filename(outFilePathFull, i), adSubfiles[key])));
*/

// Uncomment these lines to rebuild
/*
rebuildDecrypted(inFilePathFull);
*/
