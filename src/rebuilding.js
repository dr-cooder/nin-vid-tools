import {
	UINT_LENGTHS,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	adInvalidMetdataKeyMapFn,
	getConstantValue
} from './constants.js';
import {
	metadataFilename,
	MAIN_SUBFILES,
	AD_SUBFILES
} from './main.js';
import {
	flattenObject,
	readFromFileIfItExists,
	isType
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
			const untilOffset = cursor + metadata[dataSectionKey];
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

const rebuildToBuffer = ({ buffer, dataSections, adCount, mainOffsets, adsOffsets, mainMetadata, adsMetadata, subfiles }) => {
	const invalidMetadataKeys = [];
	let cursor = 0;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		try {
			const valueFromMetadata = mainMetadata[dataSectionKey];
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
						try {
							cursor += writeDataSection(buffer, cursor, adsMetadata[i][dataSectionKey], dataSection);
						} catch (error) { // TODO: DRY
							if (isType(error, TypeError)) {
								invalidMetadataKeys.push(adInvalidMetdataKeyMapFn(i)(dataSectionKey));
							} else {
								throw error;
							}
						}
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

export const rebuildDecrypted = (outFilename) => { // TODO: This function should not search for filenames itself, instead taking in metadata and buffer dictionaries as arguments
	const missingSubfilenames = [];
	const invalidMetadataKeys = [];
	let metadataHasSyntaxErrors = false;

	const outMetadataFilename = metadataFilename(outFilename);
	const metadataData = readFromFileIfItExists(outMetadataFilename);
	let mainMetadata;
	let adsMetadata = [];
	let adCount = 0;
	let adsSubfiles = [];

	if (metadataData === undefined) {
		missingSubfilenames.push(outMetadataFilename);
	} else {
		try {
			mainMetadata = JSON.parse(metadataData);
		} catch (jsonParseError) {
			if (isType(jsonParseError, SyntaxError)) {
				metadataHasSyntaxErrors = true;
			} else {
				throw jsonParseError;
			}
		}
		adsMetadata = mainMetadata?.ads;
		delete mainMetadata?.ads;
		mainMetadata = flattenObject(mainMetadata);
		if (isType(adsMetadata, Array)) {
			adCount = adsMetadata.length;
			adsMetadata = adsMetadata.map(flattenObject);
			adsSubfiles = [...Array(adCount).keys().map(i => readSubfiles({
				subfileSpecs: AD_SUBFILES,
				filenameFunctionParams: [outFilename, i],
				missingSubfilenameCallback: (subfilename) => {
					missingSubfilenames.push(subfilename);
				}
			}))];
		} else {
			adsMetadata = [];
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
			metadata: mainMetadata,
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
			invalidMetadataKeys.push(...adInvalidTrailingZerosKeys.map(adInvalidMetdataKeyMapFn(adIndex)));
			adsOffsets[adIndex] = { ...adOffsets, fileStartToAdStart: fullBufferLength };
			fullBufferLength += adEnd;
		}
		const outBuffer = Buffer.alloc(fullBufferLength);
		invalidMetadataKeys.push(...rebuildToBuffer({
			buffer: outBuffer,
			dataSections: MAIN_DATA_SECTIONS,
			adCount,
			mainOffsets,
			adsOffsets,
			mainMetadata,
			adsMetadata,
			subfiles: mainSubfiles
		}));
		for (let adIndex = 0; adIndex < adCount; adIndex++) {
			const adOffsets = adsOffsets[adIndex];
			invalidMetadataKeys.push(...rebuildToBuffer({
				buffer: outBuffer.subarray(adOffsets.fileStartToAdStart),
				dataSections: AD_DATA_SECTIONS,
				adCount,
				mainOffsets: adOffsets,
				adsOffsets: [],
				mainMetadata: adsMetadata[adIndex],
				adsMetadata: [],
				subfiles: adsSubfiles[adIndex]
			}).map(adInvalidMetdataKeyMapFn(adIndex)));
		}
		const invalidMetadataUniqueKeys = [...new Set(invalidMetadataKeys)];
		const invalidMetadataUniqueKeyCount = invalidMetadataUniqueKeys.length;
		if (invalidMetadataUniqueKeyCount) {
			throw new TypeError(`The following metadata key${invalidMetadataUniqueKeyCount === 1 ? ' is' : 's are'} missing or of the wrong data type:\n${invalidMetadataUniqueKeys.join('\n')}`);
		}
		return outBuffer;
	}
};
