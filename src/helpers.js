import fs from 'fs';

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

export const readFromFileIfItExists = (filename) => {
	let data;
	try {
		data = fs.readFileSync(filename);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw error;
		}
	}
	return data;
};

export const handleDataSectionOddity = (message) => { // TODO: Take a logger function
	console.warn(`WARNING: ${message}; this will not be reflected when rebuilding!`);
};
