import {
	UINT_LENGTHS,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	adInvalidMetdataKeyMapFn,
	getConstantValue
} from './constants.js';
import {
	flattenObject,
	isType
} from './helpers.js';

const getOffsetsAndLength = ({ dataSections, metadata, subfiles, adCount }) => {
	const invalidTrailingZerosKeys = [];
	const offsets = {};
	let cursor = 0;
	let length;

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
					length = untilOffset;
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
				case 'adStartOffsets':
				case 'adMetas':
					cursor += dataSectionActualLength * adCount;
					break;
				default:
					cursor += dataSectionActualLength;
			}
		}
	}

	return { invalidTrailingZerosKeys, offsets, length };
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

const rebuildToBuffer = ({ buffer, bufferStart = 0, dataSections, adCount, mainOffsets, adStartOffsets, mainMetadata, adsMetadata, subfiles }) => {
	const invalidMetadataKeys = [];
	let cursor = bufferStart;

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
				case 'adStartOffsets':
					for (let i = 0; i < adCount; i++) {
						cursor += writeDataSection(buffer, cursor, adStartOffsets[i], dataSection);
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

export const rebuildDecrypted = ({ metadata, mainSubfiles, adsSubfiles }) => {
	const invalidMetadataKeys = [];
	const mainMetadataUnflattened = { ...metadata };
	delete mainMetadataUnflattened.ads;
	const mainMetadata = flattenObject(mainMetadataUnflattened);
	const adsMetadataUnflattened = metadata.ads;
	let adsMetadata = [];
	let adCount = 0;
	if (isType(adsMetadataUnflattened, Array)) {
		adCount = adsMetadataUnflattened.length;
		adsMetadata = adsMetadataUnflattened.map(flattenObject);
	} else {
		invalidMetadataKeys.push('ads');
	}
	const {
		invalidTrailingZerosKeys: mainInvalidTrailingZerosDataKeys,
		offsets: mainOffsets,
		length: mainLength
	} = getOffsetsAndLength({
		dataSections: MAIN_DATA_SECTIONS,
		metadata: mainMetadata,
		subfiles: mainSubfiles,
		adCount
	});
	invalidMetadataKeys.push(...mainInvalidTrailingZerosDataKeys);
	const adsOffsets = [];
	const adStartOffsets = [];
	let fullBufferLength = mainLength;
	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const {
			invalidTrailingZerosKeys: adInvalidTrailingZerosKeys,
			offsets: adOffsets,
			length: adLength
		} = getOffsetsAndLength({
			dataSections: AD_DATA_SECTIONS,
			metadata: adsMetadata[adIndex],
			subfiles: adsSubfiles[adIndex]
		});
		invalidMetadataKeys.push(...adInvalidTrailingZerosKeys.map(adInvalidMetdataKeyMapFn(adIndex)));
		adsOffsets[adIndex] = adOffsets;
		adStartOffsets[adIndex] = fullBufferLength;
		fullBufferLength += adLength;
	}
	const outBuffer = Buffer.alloc(fullBufferLength);
	invalidMetadataKeys.push(...rebuildToBuffer({
		buffer: outBuffer,
		dataSections: MAIN_DATA_SECTIONS,
		adCount,
		mainOffsets,
		adStartOffsets,
		mainMetadata,
		adsMetadata,
		subfiles: mainSubfiles
	}));
	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		invalidMetadataKeys.push(...rebuildToBuffer({
			buffer: outBuffer,
			bufferStart: adStartOffsets[adIndex],
			dataSections: AD_DATA_SECTIONS,
			adCount,
			mainOffsets: adsOffsets[adIndex],
			adStartOffsets: [],
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
};
