# nin-vid-tools
Command-line tools and package to extract and rebuild [Nintendo Video](https://en.wikipedia.org/wiki/Nintendo_Video) BOSS files. **(WIP)**
## Setup
1. [Install Node.js and npm.](https://nodejs.org/en/download)
2. [Download the source code ZIP file.](https://github.com/dr-cooder/nin-vid-tools/archive/refs/heads/master.zip)
3. Extract the ZIP file somewhere.
4. Open a terminal window in the folder.
5. Run `npm`.
6. If you want to extract from and rebuild to encrypted BOSS files, you will need to provide the BOSS AES encryption key as a hexadecimal string. **I will not tell you how to acquire this key, but the program will verify that it was input correctly.**
	- Option 1: Create a file named `.env` at the root of the folder with `BOSS_AES_KEY=(insert key here)` as its contents.
	- Option 2: Use the option `-k (insert key here)` or `--boss-aes-key (insert key here)` when running a command that involves either decryption or encryption.
7. If you want to convert MOFLEX files to more common video formats like MP4, you will need to [install FFmpeg.](https://www.ffmpeg.org)
## Usage
Nintendo Video BOSS files can be in three possible states, represented by files with the following extensions:
1. Encrypted
	- BOSS: `name.boss`
2. Decrypted
	- Options: `name.boss.options.json`
	- Content: `name.boss.content.bin`
3. Extracted
	- Options: `name.boss.options.json`
	- Metadata: `name.boss.content.bin.meta.json`
	- Video: `name.boss.content.bin.video.moflex`
	- Thumbnail: `name.boss.content.bin.thumb.jpg`
	- Bottom screen ad image(s): `name.boss.content.bin.ad1.jpg` (, `name.boss.content.bin.ad2.jpg`, ...)

They can be converted between these states with the following commands:
- Encrypted &rarr; Extracted: `src/nin-vid-tools.js decrypt-and-extract name.boss` **(Not yet implemented)**
- Extracted &rarr; Encrypted: `src/nin-vid-tools.js rebuild-and-encrypt name.boss` **(Not yet implemented)**
- Encrypted &rarr; Decrypted: `src/nin-vid-tools.js decrypt name.boss`
- Decrypted &rarr; Extracted: `src/nin-vid-tools.js extract name.boss.content.bin`
- Extracted &rarr; Decrypted: `src/nin-vid-tools.js rebuild name.boss.content.bin`
- Decrypted &rarr; Encrypted: `src/nin-vid-tools.js encrypt name.boss`
The program will ask you if you want to overwrite files. To suppress this, add the `-y` or `--yes-overwrite` option.

You can also use the `convert` command to convert MOFLEX files to more common video formats like MP4 using FFmpeg, auto-detecting their 3D format **(Not yet implemented; for now, use the option `-3` or `--is-3d`)** and reformatting them as side-by-side if applicable. Simply provide the MOFLEX filename and the rest of the FFmpeg options; unless the only one of those you wish to provide is the output filename, please denote the start of them with `--`. If you want to watch the video in a 3D video player that compensatively stretches each half of the video, add the option `-s` or `--stretch`. **I will not tell you how to convert common video formats to MOFLEX.**

`src/nin-vid-tools.js convert name.boss.content.bin.video.moflex -s -- -y name.boss.content.bin.video.moflex.mp4`

## Important Disclaimer
**At the time of writing, this is merely a proof-of-concept. BOSS files modified by this program, especially with invalid data, have not been tested in the Nintendo Video app yet. Please do not try to run the output of this program in-app, especially with real hardware, lest something important break.**
