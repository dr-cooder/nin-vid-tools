export const UINT_LENGTHS = {
	'8': 0x1,
	'16LE': 0x2,
	'32LE': 0x4
};

export const AD_COUNT_OFFSET = 0xCC;

// TODO: Make this class and method-based?
export const MAIN_DATA_SECTIONS = [
	// { type: 'constant', format: '32LE', addend: 0x0 },
	// { type: 'constant', format: '32LE', adCountMultiplier: 0x4, addend: 0x1C },
	// { type: 'constant', format: '32LE', adCountMultiplier: 0x4, addend: 0x1C },
	{ type: 'meta', length: 0xC, format: 'hex', key: 'mysteryChunks.startOfFile' }, // Always 00000000 followed by two identical uint32LE's of 0x1C + 0x4 * adCount
	{ type: 'offset', format: '32LE', key: 'fileStartToThumbnailStart' },
	{ type: 'offset', format: '32LE', key: 'thumbnailStartToThumbnailEnd' },
	// { type: 'constant', format: '32LE', addend: 0x0 },
	{ type: 'meta', length: 0x4, format: 'hex', key: 'mysteryChunks.betweenThumbnailStartToThumbnailEndAndAdCount' }, // Always 00000000
	// { type: 'constant', format: '32LE', adCountMultiplier: 0x1 },
	{ type: 'meta', length: 0x4, format: 'hex', key: 'mysteryChunks.adCount32LE' }, // Always ad count
	{ type: 'adOffsets', format: '32LE', key: 'fileStartToAdStart' },
	// { type: 'constant', format: '32LE', addend: 0x248 },
	{ type: 'meta', length: 0x4, format: 'hex', key: 'mysteryChunks.betweenAdOffsetsAndID' }, // Always 48020000
	{ type: 'meta', length: 0x20, format: 'utf8', key: 'id' },
	// Keep in mind the 3DS system clock is infamously timezone-naive https://www.reddit.com/r/3DS/comments/2ybjb9/remember_to_set_the_clock_on_your_3ds_forward_1/
	{ type: 'meta', format: '16LE', key: 'availabilityWindow.start.year' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.month' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.day' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.hour' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.minute' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.second' },
	// { type: 'constant', format: '8', addend: 0x0 },
	{ type: 'meta', length: 0x1, format: 'hex', key: 'mysteryChunks.afterAvailabilityWindowStart' }, // Always 00
	{ type: 'meta', format: '16LE', key: 'availabilityWindow.end.year' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.month' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.day' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.hour' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.minute' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.second' },
	// { type: 'constant', format: '8', addend: 0x0 },
	{ type: 'meta', length: 0x1, format: 'hex', key: 'mysteryChunks.afterAvailabilityWindowEnd' }, // Always 00
	{ type: 'meta', length: 0x78, format: 'utf16le', key: 'title' },
	// { type: 'constant', format: '8', adCountMultiplier: 0x1 },
	// { type: 'constant', format: '8', addend: 0xFF },
	{ type: 'meta', length: 0x2, format: 'hex', key: 'mysteryChunks.betweenTitleAndMinimumViewerAge' }, // Always a uint8 of ad count followed by FF
	{ type: 'meta', format: '32LE', key: 'minimumViewerAge' }, // In years, for age-restriction
	// { type: 'constant', format: '16LE', addend: 0x0 },
	{ type: 'meta', length: 0x2, format: 'hex', key: 'mysteryChunks.betweenMinimumViewerAgeAndMoflexStartToMoflexEnd' }, // Always 0000
	{ type: 'offset', format: '32LE', key: 'moflexStartToMoflexEnd' },
	{ type: 'meta', length: 0x190, format: 'utf16le', key: 'description' },
	{ type: 'adMetas', length: 0x20, format: 'utf8', key: 'id1' },
	{ type: 'subfile', length: 'moflexStartToMoflexEnd', key: 'video' },
	{ type: 'trailingZeros', until: 'fileStartToThumbnailStart', key: 'trailingZeros.moflex' },
	{ type: 'subfile', length: 'thumbnailStartToThumbnailEnd', key: 'thumbnail' },
	{ type: 'trailingZeros', key: 'trailingZeros.thumbnail' }
];

export const AD_DATA_SECTIONS = [
	// { type: 'constant', format: '32LE', addend: 0x16C },
	{ type: 'offset', format: '32LE', key: 'adStartToImageStart' }, // Always 6C010000 (0x16C)
	{ type: 'meta', length: 0x30, format: 'utf8', key: 'id2' }, // Always the same as id1 - consolidate to "id" and note if they differ
	{ type: 'meta', length: 0x8, format: 'hex', key: 'mysteryChunks.betweenId2AndLinkURL' }, // Maybe something to do with timestamp?
	{ type: 'meta', length: 0x100, format: 'utf8', key: 'linkURL' }, // eShop links are "tiger://<title ID>"
	{ type: 'meta', length: 0x4, format: 'hex', key: 'mysteryChunks.betweenLinkUrlAndLinkText' }, // Last byte is always 00, other bytes are usually FFFFFF, or at least usually all have the same digits?
	{ type: 'meta', length: 0x28, format: 'utf16le', key: 'linkText' },
	{ type: 'offset', format: '32LE', key: 'imageStartToImageEnd' },
	{ type: 'trailingZeros', until: 'adStartToImageStart', key: 'trailingZeros.metadata' }, // Always zero
	{ type: 'subfile', length: 'imageStartToImageEnd', key: 'image' },
	{ type: 'trailingZeros', key: 'trailingZeros.image' }
];

export const metadataFilename = filename => `${filename}.meta.json`;

export const MAIN_SUBFILES = [
	{ key: 'video', filename: filename => `${filename}.video.moflex` },
	{ key: 'thumbnail', filename: filename => `${filename}.thumb.jpg` }
];

export const AD_SUBFILES = [
	{ key: 'image', filename: (filename, index) => `${filename}.ad${index + 1}.jpg` }
];
