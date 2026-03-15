/**
 * Example: Read tags and audio properties from an audio file.
 *
 * Usage (Node.js):
 *   npx tsx examples/tagreader.ts path/to/audio.mp3
 */
import { readFileSync } from "fs";
import { readTags } from "@dantheman827/taglib-ts/simpleApi.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx examples/tagreader.ts <audio-file>");
  process.exit(1);
}

const data = new Uint8Array(readFileSync(filePath));
const filename = filePath.split("/").pop() ?? "";

const tags = await readTags({ data, filename });

console.log("-- Tag --");
console.log(`Title:   ${tags.title}`);
console.log(`Artist:  ${tags.artist}`);
console.log(`Album:   ${tags.album}`);
console.log(`Genre:   ${tags.genre}`);
console.log(`Year:    ${tags.year}`);
console.log(`Track:   ${tags.track}`);
console.log(`Comment: ${tags.comment}`);

if (tags.audioProperties) {
  const ap = tags.audioProperties;
  console.log("\n-- Audio Properties --");
  console.log(`Bitrate:     ${ap.bitrate} kb/s`);
  console.log(`Sample Rate: ${ap.sampleRate} Hz`);
  console.log(`Channels:    ${ap.channels}`);
  console.log(`Duration:    ${ap.lengthInSeconds}s (${ap.lengthInMilliseconds}ms)`);
}
