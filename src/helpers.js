import fs from 'fs';
import { keyInYN } from 'readline-sync';

const DELIMITER = '.';

// TODO: flatten and unflatten metadata only when reading and writing, respectively
// https://www.30secondsofcode.org/js/s/flatten-unflatten-object
export const getValue = (object, path) =>
	path == null
		? object
		: path.split(DELIMITER).reduce((currentValue, key) => currentValue?.[key], object);

const setValueRecursion = (object, keys, value) => {
	const [currentKey, ...remainingKeys] = keys;

	if (remainingKeys.length === 0) {
		object[currentKey] = value;
	} else {
		object[currentKey] = object[currentKey] ?? {};
		setValueRecursion(object[currentKey], remainingKeys, value);
	}

	return object;
};

export const setValue = (object, path, value) => setValueRecursion(object, path.split(DELIMITER), value);

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

export const isType = (object, type) =>
	type == null
		? object === type
		: object != null && object.constructor === type;

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
