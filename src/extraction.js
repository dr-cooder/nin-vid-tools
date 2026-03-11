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
	uintToBufferString
} from './helpers.js';

const readDataSection = (buffer, cursor, { length, format }) =>
	isType(length, Number) // Only subfiles have variable length, not metadata
		? { value: buffer.subarray(cursor, cursor + length).toString(format).replace(/[\0]+$/, ''), length }
		: (format == null ? { length } : { value: buffer[`readUint${format}`](cursor), length: UINT_LENGTHS[format] });

const extractFromBuffer = ({ adIndex = -1, adCount, lastAd, buffer, bufferStart = 0, bufferEnd = buffer.length, dataSections }) => {
	const adMetadataKeyFn = adIndex !== -1 && adInvalidMetdataKeyMapFn(adIndex);
	const offsets = {};
	const adStartOffsets = [];
	const mainMetadata = {};
	const mainSubfiles = {};
	const adsMetadata = arrayOfEmptyObjects(adCount);
	const dataSectionOddities = [];
	let cursor = bufferStart;

	for (const dataSection of dataSections) {
		const {
			type: dataSectionType,
			key: dataSectionKey
		} = dataSection;
		const dataSectionKeyFormatted = JSON.stringify(adMetadataKeyFn ? adMetadataKeyFn(dataSectionKey) : dataSectionKey);
		if (dataSectionType === 'trailingZeros') {
			const dataSectionUntil = dataSection.until;
			const untilOffset = dataSectionUntil === undefined
				? (adCount
					? adStartOffsets[0]
					: bufferEnd)
				: offsets[dataSectionUntil];
			const untilOffsetFormatted = `${dataSectionUntil === undefined
				? (lastAd
					? 'the end of the file'
					: `the start of ad ${adIndex + 2}`)
				: JSON.stringify(dataSectionUntil)
			}, which is 0x${untilOffset.toString(16)}`;
			if (untilOffset < cursor) {
				throw new Error(`"until" prop of ${dataSectionKeyFormatted} (${untilOffsetFormatted}) is before the cursor (0x${cursor.toString(16)})`);
			} else {
				const trailingZerosString = buffer.subarray(cursor, untilOffset).toString('hex');
				if (/^(0{2})*$/.test(trailingZerosString)) {
					mainMetadata[dataSectionKey] = untilOffset - cursor;
				} else {
					dataSectionOddities.push(`The leftover data leading up to ${untilOffsetFormatted}, is not all zero bytes (${trailingZerosString})`);
				}
				cursor = untilOffset;
			}
		} else {
			const {
				value: dataSectionValue,
				length: dataSectionLength
			} = readDataSection(buffer, cursor, dataSection);
			const cursorAfterOffset = cursor + offsets[dataSectionLength];
			const cursorPlusLength = cursor + dataSectionLength;
			const constantValue = getConstantValue({ adCount, dataSection });
			const previousMetaValue = mainMetadata[dataSectionKey];
			switch (dataSectionType) {
				case 'offset':
					offsets[dataSectionKey] = dataSectionValue;
					cursor = cursorPlusLength;
					break;
				case 'meta':
					if (previousMetaValue === undefined) {
						mainMetadata[dataSectionKey] = dataSectionValue;
					} else if (previousMetaValue !== dataSectionValue) {
						dataSectionOddities.push(`Metadata key ${dataSectionKeyFormatted} has value ${JSON.stringify(previousMetaValue)} in the first position and value ${JSON.stringify(dataSectionValue)} in the second position`);
					}
					cursor = cursorPlusLength;
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
						dataSectionOddities.push(`The data section from 0x${cursor.toString(16)} to 0x${cursorPlusLength.toString(16)} was expected to be ${uintToBufferString(constantValue, dataSection.format)} but was ${buffer.subarray(cursor, cursorPlusLength).toString('hex')}`);
					}
					cursor = cursorPlusLength;
					break;
				default:
			}
		}
	}

	return { mainMetadata, mainSubfiles, adsMetadata, adStartOffsets, dataSectionOddities };
};

export const extractDecrypted = (inFileDataDecrypted) => {
	const adCount = inFileDataDecrypted.readUint8(AD_COUNT_OFFSET);
	const adsSubfiles = [];
	const { mainMetadata, mainSubfiles, adsMetadata, adStartOffsets, dataSectionOddities } = extractFromBuffer({
		adCount,
		buffer: inFileDataDecrypted,
		dataSections: MAIN_DATA_SECTIONS
	});

	for (let adIndex = 0; adIndex < adCount; adIndex++) {
		const nextAdIndex = adIndex + 1;
		const lastAd = nextAdIndex === adCount;
		const {
			mainMetadata: adMetadata,
			mainSubfiles: adSubfiles,
			dataSectionOddities: adDataSectionOddities
		} = extractFromBuffer({
			adIndex,
			lastAd,
			buffer: inFileDataDecrypted,
			bufferStart: adStartOffsets[adIndex],
			bufferEnd: lastAd
				? undefined
				: adStartOffsets[nextAdIndex],
			dataSections: AD_DATA_SECTIONS
		});
		Object.assign(adsMetadata[adIndex], adMetadata);
		adsSubfiles[adIndex] = adSubfiles;
		dataSectionOddities.push(...adDataSectionOddities);
	}

	return {
		metadata: { ...unflattenObject(mainMetadata), ads: adsMetadata.map(unflattenObject) },
		mainSubfiles,
		adsSubfiles,
		dataSectionOddities: dataSectionOddities.length
			? `WARNING: The following will not be reflected when rebuilding:${dataSectionOddities.map(oddity => `\n\t${oddity}`).join('')}`
			: undefined
	};
};
