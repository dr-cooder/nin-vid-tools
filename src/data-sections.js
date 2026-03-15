export const AD_COUNT_OFFSET = 0x18;

// TODO: Make this class and method-based?
export const MAIN_DATA_SECTIONS = [
	{ type: 'constant', format: '32LE', addend: 0x0 },
	{ type: 'constant', format: '32LE', adCountMultiplier: 0x4, addend: 0x1C },
	{ type: 'constant', format: '32LE', adCountMultiplier: 0x4, addend: 0x1C },
	{ type: 'offset', format: '32LE', key: 'thumbnailStart' },
	{ type: 'offset', format: '32LE', key: 'thumbnailLength' },
	{ type: 'constant', format: '32LE', addend: 0x0 },
	{ type: 'constant', format: '32LE', adCountMultiplier: 0x1 },
	{ type: 'adStartOffsets', format: '32LE' },
	{ type: 'constant', format: '32LE', addend: 0x248 },
	{ type: 'meta', length: 0x20, format: 'utf8', key: 'id' },
	// Keep in mind the 3DS system clock is infamously timezone-naive https://www.reddit.com/r/3DS/comments/2ybjb9/remember_to_set_the_clock_on_your_3ds_forward_1/
	{ type: 'meta', format: '16LE', key: 'availabilityWindow.start.year' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.month' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.day' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.hour' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.minute' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.start.second' },
	{ type: 'constant', format: '8', addend: 0x0 },
	{ type: 'meta', format: '16LE', key: 'availabilityWindow.end.year' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.month' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.day' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.hour' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.minute' },
	{ type: 'meta', format: '8', key: 'availabilityWindow.end.second' },
	{ type: 'constant', format: '8', addend: 0x0 },
	{ type: 'meta', length: 0x78, format: 'utf16le', key: 'title' },
	{ type: 'constant', format: '8', adCountMultiplier: 0x1 },
	{ type: 'constant', format: '8', addend: 0xFF },
	{ type: 'meta', format: '32LE', key: 'minimumViewerAge' }, // In years, for age-restriction
	{ type: 'constant', format: '16LE', addend: 0x0 },
	{ type: 'offset', format: '32LE', key: 'videoLength' },
	{ type: 'meta', length: 0x190, format: 'utf16le', key: 'description' },
	{ type: 'adMetas', length: 0x20, format: 'utf8', key: 'id' },
	{ type: 'subfile', length: 'videoLength', key: 'video' },
	{ type: 'trailingZeros', until: 'thumbnailStart', key: 'trailingZeros.moflex' },
	{ type: 'subfile', length: 'thumbnailLength', key: 'thumbnail' },
	{ type: 'trailingZeros', key: 'trailingZeros.thumbnail' }
];

export const AD_DATA_SECTIONS = [
	{ type: 'constant', format: '32LE', addend: 0x16C },
	{ type: 'meta', length: 0x30, format: 'utf8', key: 'id' },
	{ type: 'meta', length: 0x8, format: 'hex', key: 'mysteryChunks.betweenIdAndLinkURL' }, // Maybe something to do with the timestamp at which the ad appears?
	{ type: 'meta', length: 0x100, format: 'utf8', key: 'linkURL' }, // eShop links are "tiger://<title ID>"
	{ type: 'meta', length: 0x4, format: 'hex', key: 'mysteryChunks.betweenLinkUrlAndLinkText' }, // Last byte is always 00, other bytes are usually FFFFFF, or at least usually all have the same digits? An RGB color?
	{ type: 'meta', length: 0x28, format: 'utf16le', key: 'linkText' },
	{ type: 'offset', format: '32LE', key: 'imageLength' },
	{ type: 'subfile', length: 'imageLength', key: 'image' },
	{ type: 'trailingZeros', key: 'trailingZeros.image' }
];

export const adInvalidMetdataKeyMapFn = adIndex => invalidMetadataKey => `ads[${adIndex}].${invalidMetadataKey}`;

export const getConstantValue = ({ adCount = 0, dataSection: { adCountMultiplier = 0, addend = 0 } }) => adCountMultiplier * adCount + addend;
