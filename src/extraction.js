import {
	UINT_LENGTHS,
	AD_COUNT_OFFSET,
	MAIN_DATA_SECTIONS,
	AD_DATA_SECTIONS,
	getConstantValue
} from './constants.js';
import {
	getValue,
	setValue,
	arrayOfEmptyObjects,
	isType,
	handleDataSectionOddity
} from './helpers.js';

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
                        // TODO: print as hex buffer, not number (this is a problem in other error messages too)
                    }
                    cursor += dataSectionLength;
                    break;
                default:
            }
        }
    }

    return { adsOffsets };
};

export const extractDecrypted = (inFileDataDecrypted) => {
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
