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
	handleDataSectionOddity
} from './helpers.js';

const readDataSection = (buffer, cursor, { length, format }) => ({
	format, ...(isType(length, Number) // Only subfiles have variable length, not metadata
		? { value: buffer.subarray(cursor, cursor + length).toString(format).replace(/[\0]+$/, ''), length }
		: (format == null ? { length } : { value: buffer[`readUint${format}`](cursor), length: UINT_LENGTHS[format] }))
});

const extractFromBuffer = ({ adMetadataKeyFn, adCount, buffer, bufferStart = 0, bufferEnd = buffer.length, dataSections, offsets, metadata, subfiles }) => { // TODO: make this a pure function; don't mutate the last 3 params
	const adsMetadata = arrayOfEmptyObjects(adCount);
	const adsOffsets = arrayOfEmptyObjects(adCount);
	const adsSubfiles = arrayOfEmptyObjects(adCount);
	let cursor = bufferStart;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		const dataSectionReadResult = readDataSection(buffer, cursor, dataSection);
		if (dataSectionType === 'trailingZeros') {
			const dataSectionUntil = dataSection.until;
			const untilOffset = dataSectionUntil === undefined
				? (adCount
					? adsOffsets[0].fileStartToAdStart
					: bufferEnd)
				: offsets[dataSectionUntil];
			if (untilOffset < cursor) {
				throw new Error(`"until" prop of ${JSON.stringify(dataSectionKey)} (${dataSectionUntil == null ? 'start of first ad' : JSON.stringify(dataSectionUntil)}, which is 0x${untilOffset.toString(16)}) is before the cursor (0x${cursor.toString(16)})`);
			} else {
				const trailingZerosString = untilOffset !== undefined && buffer.subarray(cursor, untilOffset).toString('hex');
				if (/^(0{2})*$/.test(trailingZerosString)) {
					metadata[dataSectionKey] = untilOffset - cursor;
				} else {
					handleDataSectionOddity(`The leftover data leading up to ${JSON.stringify(dataSectionUntil)} (${trailingZerosString}) is not all zero bytes`); // TODO: specify data
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
			const previousMetaValue = metadata[dataSectionKey];
			switch (dataSectionType) {
				case 'offset':
					offsets[dataSectionKey] = dataSectionValue;
					cursor += dataSectionLength;
					break;
				case 'meta':
					if (previousMetaValue === undefined) {
						metadata[dataSectionKey] = dataSectionValue;
					} else if (previousMetaValue !== dataSectionValue) {
						handleDataSectionOddity(`Metadata key ${JSON.stringify(adMetadataKeyFn?.(dataSectionKey))} has value ${JSON.stringify(previousMetaValue)} in the first position and value ${JSON.stringify(dataSectionValue)} in the second position`);
					}
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
						adsMetadata[i][dataSectionKey] = i ? readDataSection(buffer, cursor, dataSection).value : dataSectionValue;
						cursor += dataSectionLength;
					}
					break;
				case 'subfile':
					subfiles[dataSectionKey] = buffer.subarray(cursor, cursorAfterOffset);
					cursor = cursorAfterOffset;
					break;
				case 'constant':
					if (dataSectionValue !== constantValue) {
						handleDataSectionOddity(`The data section at offset 0x${cursor.toString(16)} was expected to be ${constantValue} but was ${buffer.subarray(cursor, cursor + dataSectionLength).toString('hex')}`);
						// TODO: print expected as hex buffer, not number
					}
					cursor += dataSectionLength;
					break;
				default:
			}
		}
	}

	return { adsMetadata, adsOffsets, adsSubfiles };
};

export const extractDecrypted = (inFileDataDecrypted) => {
	const offsets = {};
	const mainMetadata = {};
	const mainSubfiles = {};

	const adCount = inFileDataDecrypted.readUint8(AD_COUNT_OFFSET);

	const { adsOffsets, adsMetadata, adsSubfiles } = extractFromBuffer({
		adCount,
		buffer: inFileDataDecrypted,
		dataSections: MAIN_DATA_SECTIONS,
		offsets,
		metadata: mainMetadata,
		subfiles: mainSubfiles
	});

	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const adOffsets = adsOffsets[adIndex];
		const nextAdIndex = adIndex + 1;
		extractFromBuffer({
			adMetadataKeyFn: adInvalidMetdataKeyMapFn(adIndex),
			buffer: inFileDataDecrypted,
			bufferStart: adOffsets.fileStartToAdStart,
			bufferEnd: nextAdIndex == adCount
				? undefined
				: adsOffsets[nextAdIndex].fileStartToAdStart,
			dataSections: AD_DATA_SECTIONS,
			offsets: adOffsets,
			metadata: adsMetadata[adIndex],
			subfiles: adsSubfiles[adIndex]
		});
	}

	return { metadata: { ...unflattenObject(mainMetadata), ads: adsMetadata.map(unflattenObject) }, mainSubfiles, adsSubfiles };
};
