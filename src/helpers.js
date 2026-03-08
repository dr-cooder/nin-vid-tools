import fs from 'fs';
import { keyInYN } from 'readline-sync';

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

export const userApprovesOverwrite = (filenames, description, yOverride) => {
	if (yOverride) {
		return true;
	}

	const filesToBeOverwritten = filenames.filter(filename => fs.existsSync(filename));
	const filesToBeOverwrittenCount = filesToBeOverwritten.length;

	return filesToBeOverwrittenCount
		? keyInYN(`WARNING: The following ${description ? `${description} ` : ''} file${filesToBeOverwrittenCount === 1 ? '' : 's'} will be overwritten:\n${filesToBeOverwritten.join('\n')}\nIs this OK? (this can be overridden with the "-y" option)`)
		: true;
};

export const handleDataSectionOddity = (message) => {
	console.warn(`WARNING: ${message}; this will not be reflected when rebuilding!`);
};
