import { UINT_LENGTHS } from './constants.js';

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

export const handleDataSectionOddity = (message) => { // TODO: Rather than logging here, accumulate the oddities
	console.warn(`WARNING: ${message}; this will not be reflected when rebuilding!`);
};

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

export const uintToBufferString = (uint, format) => {
	const buffer = Buffer.alloc(UINT_LENGTHS[format]);
	buffer[`writeUint${format}`](uint);
	return buffer.toString('hex');
};
