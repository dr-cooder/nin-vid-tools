# nin-vid-tools
Command-line tools to extract and rebuild [Nintendo Video](https://en.wikipedia.org/wiki/Nintendo_Video) BOSS files. **(WIP)**
## Setup
1. [Install Node.js and npm.](https://nodejs.org/en/download)
2. [Download the source code ZIP file.](https://github.com/dr-cooder/nin-vid-tools/archive/refs/heads/master.zip)
3. Extract the ZIP file somewhere.
4. Open a terminal window in the folder.
5. Run `npm`.
6. If you want to extract from and rebuild to encrypted BOSS files, you will need to provide the BOSS AES encryption key as a hexadecimal string.  **I will not tell you how to acquire this key, but the program will verify that it was input correctly.**
    - Option 1: Create a file named `.env` at the root of the folder with `BOSS_AES_KEY=(insert key here)` as its contents.
    - Option 2: Use the option `-k (insert key here)` or `--boss-aes-key (insert key here)` when running a command that involves either decryption or encryption.
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
(Todo: create and explain the commands to get the file between these states)
## Important Disclaimer
**At the time of writing, this is merely a proof-of-concept. BOSS files modified by this program, especially with invalid data, have not been tested in the Nintendo Video app yet. Please do not try to run the output of this program in-app, especially with real hardware, lest something important break.**
