import {
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	adInvalidMetdataKeyMapFn,
	getConstantValue
} from '#data-sections';
import {
	flattenObject,
	isType,
	catchError,
	intFormatLength,
	accessBufferUInt,
	isOrAre,
	tabbedLines
} from '#helpers';

const getOffsetsAndLength = ({ dataSections, metadata, subfiles, adCount }) => {
	const invalidTrailingZerosKeys = [];
	const missingSubfiles = [];
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
			if (dataSectionType === 'subfile') {
				const subfile = subfiles[dataSectionKey];
				if (isType(subfile, Buffer)) {
					const subfileLength = subfile.length;
					offsets[dataSectionLength] = subfileLength;
					cursor += subfileLength;
				} else {
					missingSubfiles.push(dataSectionKey);
					offsets[dataSectionLength] = 0;
				}
			} else {
				const dataSectionActualLength = isType(dataSectionLength, Number) ? dataSectionLength : intFormatLength(dataSection.format);
				cursor += (dataSectionType === 'adStartOffsets' || dataSectionType === 'adMetas')
					? dataSectionActualLength * adCount
					: dataSectionActualLength;
			}
		}
	}

	return { invalidTrailingZerosKeys, missingSubfiles, offsets, length: length ?? cursor };
};

const writeDataSection = (buffer, cursor, value, { length, format }) => {
	if (value == null) {
		throw new TypeError();
	}
	let offset = 0;
	if (isType(length, Number)) {
		if (!isType(value, String)) {
			throw new TypeError();
		}
		Buffer.from(value, format).copy(buffer, cursor, 0, length); // This assumes it's already writing over 0x00's such that they may trail until length is reached
		offset = length;
	} else {
		if (!isType(value, Number)) {
			throw new TypeError();
		}
		accessBufferUInt({ buffer, format, uInt: value, offset: cursor });
		offset = intFormatLength(format);
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
		catchError(TypeError, () => {
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
						catchError(TypeError, () => {
							cursor += writeDataSection(buffer, cursor, adsMetadata[i][dataSectionKey], dataSection);
						}, () => invalidMetadataKeys.push(adInvalidMetdataKeyMapFn(i)(dataSectionKey)));
					}
					break;
				case 'subfile':
					subfiles[dataSectionKey]?.copy(buffer, cursor);
					cursor += subfiles[dataSectionKey]?.length;
					break;
				case 'trailingZeros':
					if (isType(valueFromMetadata, Number)) {
						cursor += valueFromMetadata; // Assumes bytes being skipped over are already all zero
					} else {
						throw new TypeError();
					}
					break;
				case 'constant':
					cursor += writeDataSection(buffer, cursor, getConstantValue({ adCount, dataSection }), dataSection);
					break;
				default:
			}
		}, () => invalidMetadataKeys.push(dataSectionKey));
	}

	return invalidMetadataKeys;
};

export const rebuild = ({ metadata, mainSubfiles, adsSubfiles }) => {
	const invalidMetadataKeys = [];
	const missingSubfiles = [];
	let missingSubfileCount = 0;
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
		missingSubfiles: mainMissingSubfiles,
		offsets: mainOffsets,
		length: mainLength
	} = getOffsetsAndLength({
		dataSections: MAIN_DATA_SECTIONS,
		metadata: mainMetadata,
		subfiles: mainSubfiles,
		adCount
	});
	const mainMissingSubfileCount = mainMissingSubfiles.length;
	if (mainMissingSubfileCount) {
		missingSubfiles.push(`Main: ${mainMissingSubfiles.join(', ')}`);
		missingSubfileCount += mainMissingSubfileCount;
	}
	invalidMetadataKeys.push(...mainInvalidTrailingZerosDataKeys);
	const adsOffsets = [];
	const adStartOffsets = [];
	let fullBufferLength = mainLength;
	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const {
			invalidTrailingZerosKeys: adInvalidTrailingZerosKeys,
			missingSubfiles: adMissingSubfiles,
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
		const adMissingSubfileCount = adMissingSubfiles.length;
		if (adMissingSubfileCount) {
			missingSubfiles.push(`Ad ${adIndex + 1}: ${adMissingSubfiles.join(', ')}`);
			missingSubfileCount += adMissingSubfileCount;
		}
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
	if (invalidMetadataUniqueKeyCount || missingSubfileCount) {
		throw new Error([
			...(missingSubfileCount ? [`The following subfile${isOrAre(missingSubfileCount)} missing:${tabbedLines(missingSubfiles)}`] : []),
			...(invalidMetadataUniqueKeyCount ? [`The following metadata key${isOrAre(invalidMetadataUniqueKeyCount)} missing or of the wrong data type:${tabbedLines(invalidMetadataUniqueKeys)}`] : [])
		].join('\n'));
	}
	return outBuffer;
};
