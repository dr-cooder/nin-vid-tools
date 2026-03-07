import fs from 'fs';
// import { fileURLToPath } from 'url';
import {
	UINT_LENGTHS,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	getConstantValue,
	metadataFilename,
	MAIN_SUBFILES,
	AD_SUBFILES
} from './constants.js';
import {
	getValue,
	readFromFileIfItExists,
	isType,
	userApprovesOverwrite
} from './helpers.js';

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

export const rebuildDecrypted = (outFilename, yOverride) => {
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
