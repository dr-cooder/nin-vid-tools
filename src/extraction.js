import {
	UINT_LENGTHS,
	AD_COUNT_OFFSET,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	adInvalidMetdataKeyMapFn,
	getConstantValue
} from './constants.js';
import {
	isType,
	unflattenObject,
	arrayOfEmptyObjects,
	handleDataSectionOddity,
	uintToBufferString
} from './helpers.js';

const readDataSection = (buffer, cursor, { length, format }) =>
	isType(length, Number) // Only subfiles have variable length, not metadata
		? { value: buffer.subarray(cursor, cursor + length).toString(format).replace(/[\0]+$/, ''), length }
		: (format == null ? { length } : { value: buffer[`readUint${format}`](cursor), length: UINT_LENGTHS[format] });

const extractFromBuffer = ({ adMetadataKeyFn, adCount, buffer, bufferStart = 0, bufferEnd = buffer.length, dataSections }) => {
	const offsets = {};
	const adStartOffsets = [];
	const mainMetadata = {};
	const mainSubfiles = {};
	const adsMetadata = arrayOfEmptyObjects(adCount);
	let cursor = bufferStart;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		if (dataSectionType === 'trailingZeros') {
			const dataSectionUntil = dataSection.until;
			const untilOffset = dataSectionUntil === undefined
				? (adCount
					? adStartOffsets[0]
					: bufferEnd)
				: offsets[dataSectionUntil];
			if (untilOffset < cursor) {
				throw new Error(`"until" prop of ${JSON.stringify(dataSectionKey)} (${dataSectionUntil == null ? 'start of first ad' : JSON.stringify(dataSectionUntil)}, which is 0x${untilOffset.toString(16)}) is before the cursor (0x${cursor.toString(16)})`);
			} else {
				const trailingZerosString = buffer.subarray(cursor, untilOffset).toString('hex');
				if (/^(0{2})*$/.test(trailingZerosString)) {
					mainMetadata[dataSectionKey] = untilOffset - cursor;
				} else {
					handleDataSectionOddity(`The leftover data leading up to ${JSON.stringify(dataSectionUntil)} (${trailingZerosString}) is not all zero bytes`);
				}
				cursor = untilOffset;
			}
		} else {
			const {
				value: dataSectionValue,
				length: dataSectionLength
			} = readDataSection(buffer, cursor, dataSection);
			const cursorAfterOffset = cursor + offsets[dataSectionLength];
			const constantValue = getConstantValue({ adCount, dataSection });
			const previousMetaValue = mainMetadata[dataSectionKey];
			switch (dataSectionType) {
				case 'offset':
					offsets[dataSectionKey] = dataSectionValue;
					cursor += dataSectionLength;
					break;
				case 'meta':
					if (previousMetaValue === undefined) {
						mainMetadata[dataSectionKey] = dataSectionValue;
					} else if (previousMetaValue !== dataSectionValue) {
						handleDataSectionOddity(`Metadata key ${JSON.stringify(adMetadataKeyFn?.(dataSectionKey))} has value ${JSON.stringify(previousMetaValue)} in the first position and value ${JSON.stringify(dataSectionValue)} in the second position`);
					}
					cursor += dataSectionLength;
					break;
				case 'adStartOffsets':
					for (let i = 0; i < adCount; i++) {
						adStartOffsets[i] = i ? readDataSection(buffer, cursor, dataSection).value : dataSectionValue;
						cursor += dataSectionLength;
					}
					break;
				case 'adMetas':
					for (let i = 0; i < adCount; i++) {
						adsMetadata[i][dataSectionKey] = i ? readDataSection(buffer, cursor, dataSection).value : dataSectionValue;
						cursor += dataSectionLength;
					}
					break;
				case 'subfile':
					mainSubfiles[dataSectionKey] = buffer.subarray(cursor, cursorAfterOffset);
					cursor = cursorAfterOffset;
					break;
				case 'constant':
					if (dataSectionValue !== constantValue) {
						handleDataSectionOddity(`The data section at offset 0x${cursor.toString(16)} was expected to be ${uintToBufferString(constantValue)} but was ${buffer.subarray(cursor, cursor + dataSectionLength).toString('hex')}`);
					}
					cursor += dataSectionLength;
					break;
				default:
			}
		}
	}

	return { mainMetadata, mainSubfiles, adsMetadata, adStartOffsets };
};

export const extractDecrypted = (inFileDataDecrypted) => {
	const adCount = inFileDataDecrypted.readUint8(AD_COUNT_OFFSET);
	const adsSubfiles = [];
	const { mainMetadata, mainSubfiles, adsMetadata, adStartOffsets } = extractFromBuffer({
		adCount,
		buffer: inFileDataDecrypted,
		dataSections: MAIN_DATA_SECTIONS
	});

	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const nextAdIndex = adIndex + 1;
		const {
			mainMetadata: adMetadata,
			mainSubfiles: adSubfiles
		} = extractFromBuffer({
			adMetadataKeyFn: adInvalidMetdataKeyMapFn(adIndex),
			buffer: inFileDataDecrypted,
			bufferStart: adStartOffsets[adIndex],
			bufferEnd: nextAdIndex == adCount
				? undefined
				: adStartOffsets[nextAdIndex],
			dataSections: AD_DATA_SECTIONS
		});
		Object.assign(adsMetadata[adIndex], adMetadata);
		adsSubfiles[adIndex] = adSubfiles;
	}

	return { metadata: { ...unflattenObject(mainMetadata), ads: adsMetadata.map(unflattenObject) }, mainSubfiles, adsSubfiles };
};
