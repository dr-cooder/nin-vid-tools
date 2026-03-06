#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
// import { fileURLToPath } from 'url';
import {
	UINT_LENGTHS,
	AD_COUNT_OFFSET,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	getConstantValue,
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
	userApprovesOverwrite,
	handleDataSectionOddity
} from './helpers.js';
// import { decrypt3DS, encrypt3DS } from '@pretendonetwork/boss-crypto';

// --- EXTRACTION ---
// TODO: Move to a separate "extraction.js"

const readDataSection = (buffer, cursor, { type, length, format, key, until }) => ({
	type, key, until, format, ...(isType(length, Number) // Only subfiles have variable length, not metadata
		? { value: buffer.subarray(cursor, cursor + length).toString(format).replace(/[\0]+$/, ''), length }
		: (format == null ? { length } : { value: buffer[`readUint${format}`](cursor), length: UINT_LENGTHS[format] }))
});

const extractFromBuffer = ({ adCount, buffer, dataSections, offsets, metadata, subfiles }) => { // TODO: make this a pure function; don't mutate the last 3 params
	let cursor = 0;
	let adsOffsets;
	if (adCount !== undefined) {
		metadata.ads = arrayOfEmptyObjects(adCount);
		subfiles.ads = arrayOfEmptyObjects(adCount);
		adsOffsets = arrayOfEmptyObjects(adCount);
	}

	for (const dataSection of dataSections) {
		const dataSectionReadResult = readDataSection(buffer, cursor, dataSection);
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSectionReadResult;
		if (dataSectionType === 'trailingZeros') {
			const dataSectionUntil = dataSectionReadResult.until;
			const untilOffset = dataSectionUntil === undefined
				? (adCount
					? adsOffsets[0].fileStartToAdStart
					: buffer.length)
				: offsets[dataSectionUntil];
			if (untilOffset < cursor) {
				throw new Error(`"until" prop of "${dataSectionKey}" (${dataSectionUntil == null ? 'start of first ad' : `"${dataSectionUntil}"`}, which is ${untilOffset}) is before the cursor (${cursor})`);
			} else {
				const trailingZerosString = untilOffset !== undefined && buffer.subarray(cursor, untilOffset).toString('hex');
				if (/^(0{2})*$/.test(trailingZerosString)) {
					setValue(metadata, dataSectionKey, untilOffset - cursor);
				} else {
					handleDataSectionOddity(`The leftover data leading up to "${dataSectionUntil}" (${trailingZerosString}) is not all zero bytes`);
				}
				cursor = untilOffset;
			}
		} else {
			const {
				value: dataSectionValue,
				length: dataSectionLength
			} = dataSectionReadResult;
			const cursorAfterOffset = cursor + offsets[dataSectionLength];
			const constantValue = getConstantValue({ adCount, dataSection });
			const previousMetaValue = getValue(metadata, dataSectionKey);
			switch (dataSectionType) {
				case 'offset':
					offsets[dataSectionKey] = dataSectionValue;
					cursor += dataSectionLength;
					break;
				case 'meta':
					if (previousMetaValue === undefined) {
						setValue(metadata, dataSectionKey, dataSectionValue);
					} else if (previousMetaValue !== dataSectionValue) {
						handleDataSectionOddity(`Ad metadata key "${dataSectionKey}" has value "${previousMetaValue}" in the first position and value "${dataSectionValue}" in the second position`);
					} // TODO: note ad index
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
				case 'constant':
					if (dataSectionValue !== constantValue) {
						handleDataSectionOddity(`The data section at offset 0x${cursor.toString(16)} was expected to be ${constantValue} but was ${dataSectionValue}`);
						// TODO: when extracting from an ad, the cursor should not be displayed as relative
						// TODO: print as hex buffer, not number
					}
					cursor += dataSectionLength;
					break;
				default:
			}
		}
	}

	return { adsOffsets };
};

const extractDecrypted = (inFileDataDecrypted) => {
	const offsets = {};
	const metadata = {};
	const subfiles = {};

	const adCount = inFileDataDecrypted.readUint8(AD_COUNT_OFFSET);

	const { adsOffsets } = extractFromBuffer({
		adCount,
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
	const invalidTrailingZerosKeys = [];
	const offsets = {};
	let cursor = 0;
	let end;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		if (dataSectionType === 'trailingZeros') {
			const dataSectionUntil = dataSection.until;
			const untilOffset = cursor + getValue(metadata, dataSectionKey);
			if (isNaN(untilOffset)) {
				invalidTrailingZerosKeys.push(dataSectionKey);
			} else {
				if (dataSectionUntil == null) {
					end = untilOffset;
				} else {
					offsets[dataSectionUntil] = untilOffset;
				}
				cursor = untilOffset;
			}
		} else {
			const dataSectionLength = dataSection.length;
			const dataSectionActualLength = isType(dataSectionLength, Number) ? dataSectionLength : UINT_LENGTHS[dataSection.format];
			switch (dataSectionType) {
				case 'subfile':
					offsets[dataSectionLength] = subfiles[dataSectionKey]?.length ?? 0;
					cursor += offsets[dataSectionLength];
					break;
				case 'adOffsets':
				case 'adMetas':
					cursor += dataSectionActualLength * adCount;
					break;
				default:
					cursor += dataSectionActualLength;
			}
		}
	}

	return { invalidTrailingZerosKeys, offsets, end };
};

const writeDataSection = (buffer, cursor, value, { length, format }) => {
	if (value == null) {
		throw new TypeError('Nullish values cannot be written to buffers');
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

const rebuildToBuffer = ({ buffer, dataSections, mainOffsets, adsOffsets, metadata, subfiles }) => {
	const adsMetadata = metadata?.ads;
	const adCount = adsMetadata?.length ?? 0;
	const invalidMetadataKeys = [];
	let cursor = 0;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		try {
			const valueFromMetadata = getValue(metadata, dataSectionKey);
			switch (dataSectionType) {
				case 'offset':
					cursor += writeDataSection(buffer, cursor, mainOffsets[dataSectionKey], dataSection);
					break;
				case 'meta':
					cursor += writeDataSection(buffer, cursor, valueFromMetadata, dataSection);
					break;
				case 'adOffsets':
					for (let i = 0; i < adCount; i++) {
						cursor += writeDataSection(buffer, cursor, adsOffsets[i][dataSectionKey], dataSection);
					}
					break;
				case 'adMetas':
					for (let i = 0; i < adCount; i++) {
						cursor += writeDataSection(buffer, cursor, getValue(adsMetadata?.[i] ?? {}, dataSectionKey), dataSection);
					}
					break;
				case 'subfile':
					subfiles[dataSectionKey]?.copy(buffer, cursor);
					cursor += subfiles[dataSectionKey]?.length;
					break;
				case 'trailingZeros':
					if (isType(valueFromMetadata, Number)) {
						cursor += valueFromMetadata; // Assumes bytes being skipped over are already all zero
					}
					break;
				case 'constant':
					cursor += writeDataSection(buffer, cursor, getConstantValue({ adCount, dataSection }), dataSection);
					break;
				default:
			}
		} catch (error) {
			if (isType(error, TypeError)) {
				invalidMetadataKeys.push(dataSectionKey);
			} else {
				throw error;
			}
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
	let adCount = 0;
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
			invalidTrailingZerosKeys: mainInvalidTrailingZerosDataKeys,
			offsets: mainOffsets,
			end: mainEnd
		} = getOffsetsAndEnd({
			dataSections: MAIN_DATA_SECTIONS,
			metadata,
			subfiles: mainSubfiles,
			adCount
		});
		invalidMetadataKeys.push(...mainInvalidTrailingZerosDataKeys);
		const adsOffsets = [];
		let fullBufferLength = mainEnd;
		for (let adIndex = 0; adIndex < adCount; adIndex++) {
			const {
				invalidTrailingZerosKeys: adInvalidTrailingZerosKeys,
				offsets: adOffsets,
				end: adEnd
			} = getOffsetsAndEnd({
				dataSections: AD_DATA_SECTIONS,
				metadata: adsMetadata[adIndex],
				subfiles: adsSubfiles[adIndex]
			});
			invalidMetadataKeys.push(...adInvalidTrailingZerosKeys.map(invalidTrailingZeroKey => `ads.${adIndex}.${invalidTrailingZeroKey}`)); // TODO: DRY
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
