const DELIMITER = '.';

export const isType = (object, type) =>
	type == null
		? object === type
		: object != null && object.constructor === type;

// https://www.30secondsofcode.org/js/s/flatten-unflatten-object

export const flattenObject = (object, prefix = '') =>
	Object.keys(object ?? {}).reduce((accumulator, key) => {
		const accumulatedKey = prefix.length ? `${prefix}${DELIMITER}${key}` : key;
		const objectValue = object[key];
		if (
			isType(objectValue, Object) &&
			Object.keys(objectValue).length > 0
		) {
			Object.assign(accumulator, flattenObject(objectValue, accumulatedKey));
		} else {
			accumulator[accumulatedKey] = objectValue;
		}
		return accumulator;
	}, {});

export const unflattenObject = object =>
	Object.keys(object ?? {}).reduce((unflattenedObject, flatKey) => {
		flatKey.split(DELIMITER).reduce(
			(value, currentKey, keyDepth, keySequence) =>
				value[currentKey] ||
				(value[currentKey] = keySequence.length - 1 === keyDepth
					? object[flatKey]
					: {}),
			unflattenedObject
		);
		return unflattenedObject;
	}, {});

export const arrayOfEmptyObjects = length => Array.from(Array(length), () => ({}));

export const catchError = (errorType, func, onCatch) => {
	try {
		func();
	} catch (error) {
		if (isType(error, errorType)) {
			onCatch();
		} else {
			throw error;
		}
	}
};

export const intFormatLength = format => ({
	8: 0x1,
	16: 0x2,
	32: 0x4,
	64: 0x8
}[format.match(/^[0-9]+/)?.[0]]);

export const accessBufferUInt = ({
	buffer,
	format,
	uInt,
	offset
}) => buffer[`${uInt === undefined ? 'read' : 'write'}${format.startsWith('64') ? 'Big' : ''}UInt${format}`](...[...(uInt === undefined ? [] : [uInt]), offset]);

export const uIntToBufferString = ({ uInt, format }) => {
	const buffer = Buffer.alloc(intFormatLength(format));
	accessBufferUInt({ buffer, format, uInt });
	return buffer.toString('hex');
};

export const isOrAre = count => count === 1 ? ' is' : 's are';

export const tabbedLines = items => items.map(item => `\n\t${item}`).join('');
