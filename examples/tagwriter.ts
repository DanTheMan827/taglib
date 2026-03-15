/**
 * Example: Write tags to an audio file.
 *
 * Usage (Node.js):
 *   npx tsx examples/tagwriter.ts path/to/audio.mp3
 */
import { readFileSync, writeFileSync } from "fs";
import { writeTags } from "../src/simpleApi.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx examples/tagwriter.ts <audio-file>");
  process.exit(1);
}

const data = new Uint8Array(readFileSync(filePath));
const filename = filePath.split("/").pop() ?? "";

const modified = await writeTags({ data, filename }, {
  title: "New Title",
  artist: "New Artist",
  album: "New Album",
  year: 2025,
  track: 1,
  genre: "Rock",
  comment: "Written by taglib-ts",
});

if (modified) {
  const outPath = filePath.replace(/(\.\w+)$/, "-tagged$1");
  writeFileSync(outPath, modified);
  console.log(`Tags written to ${outPath}`);
} else {
  console.error("Failed to write tags (unsupported format?)");
}
