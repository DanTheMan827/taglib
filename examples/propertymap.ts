/**
 * Example: Read and write properties (PropertyMap) directly.
 *
 * The PropertyMap API provides access to all metadata fields, including
 * format-specific ones not covered by the simple Tag interface (title,
 * artist, etc.). Keys are uppercase tag names like "ALBUMARTIST",
 * "TRACKNUMBER", "DISCNUMBER", "COMPILATION", etc.
 *
 * Usage (Node.js):
 *   npx tsx examples/propertymap.ts path/to/audio.mp3
 */
import { readFileSync, writeFileSync } from "fs";
import { FileRef } from "@dantheman827/taglib-ts/fileRef.js";
import { ByteVectorStream } from "@dantheman827/taglib-ts/toolkit/byteVectorStream.js";
import { PropertyMap } from "@dantheman827/taglib-ts/toolkit/propertyMap.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx examples/propertymap.ts <audio-file>");
  process.exit(1);
}

const data = new Uint8Array(readFileSync(filePath));
const filename = filePath.split("/").pop() ?? "";

// Open the file
const ref = await FileRef.fromByteArray(data, filename);
if (!ref.isValid) {
  console.error("Could not open file");
  process.exit(1);
}

// --- Read all properties ---
console.log("-- Current Properties --");
const props = ref.properties();
for (const [key, values] of props.entries()) {
  console.log(`  ${key}: ${values.join("; ")}`);
}

// --- Modify properties ---
const newProps = new PropertyMap();
// Copy existing properties
for (const [key, values] of props.entries()) {
  newProps.replace(key, values);
}
// Add/overwrite specific properties
newProps.replace("ALBUMARTIST", ["Various Artists"]);
newProps.replace("DISCNUMBER", ["1"]);
newProps.replace("COMPILATION", ["1"]);

// Apply and save
const unsupported = ref.setProperties(newProps);
if (unsupported.size > 0) {
  console.log("\nUnsupported properties:");
  for (const [key] of unsupported.entries()) {
    console.log(`  ${key}`);
  }
}

ref.save();

// --- Get modified bytes ---
const file = ref.file();
if (file) {
  const stream = file.stream() as ByteVectorStream;
  const modified = stream.data().data;
  const outPath = filePath.replace(/(\.\w+)$/, "-props$1");
  writeFileSync(outPath, modified);
  console.log(`\nModified file written to ${outPath}`);
}
