# taglib-ts

[![TypeScript Build & Test](https://github.com/DanTheMan827/taglib/actions/workflows/ts-build.yml/badge.svg)](https://github.com/DanTheMan827/taglib/actions/workflows/ts-build.yml)

Native **TypeScript** port of [TagLib](https://taglib.org/) for browsers, Node.js, and any JavaScript runtime. Reads and writes audio metadata (ID3v1, ID3v2, APE, Vorbis comments, MP4 atoms, RIFF Info, and more) for 15 container formats — no WASM, no native bindings.

## Features

- 🎵 **15 audio formats**: MP3, FLAC, MP4/AAC, OGG (Vorbis / Opus / Speex / FLAC), WAV, AIFF, MPC, WavPack, Monkey's Audio, TrueAudio, DSF, DSDIFF
- 🏷️ **All major tag formats**: ID3v1, ID3v2 (v2.2 / v2.3 / v2.4), APEv2, Vorbis Comment, FLAC Picture, RIFF Info, DSDIFF DIIN
- 📦 **Code splitting**: format readers are lazy-loaded via dynamic `import()` — only the formats you use land in your bundle
- 🌐 **Browser-first**: accepts `File`, `Blob`, and `Uint8Array` inputs
- ✅ **305 tests** ported from the C++ CppUnit suite

---

## Quick Start

```bash
npm install taglib-ts   # (package name is illustrative; use the actual published name)
```

### Simple API — read tags

```ts
import { readTags } from 'taglib-ts';

// Browser File picker
const [file] = await showOpenFilePicker({ types: [{ accept: { 'audio/*': [] } }] });
const tags = await readTags(await file.getFile());

console.log(tags.title);                        // "Bohemian Rhapsody"
console.log(tags.artist);                       // "Queen"
console.log(tags.audioProperties?.bitrate);     // 320  (kb/s)
console.log(tags.audioProperties?.lengthInSeconds); // 354
```

### Simple API — write tags

```ts
import { writeTags } from 'taglib-ts';

const modified = await writeTags(file, {
  title:  'My Track',
  artist: 'My Artist',
  album:  'My Album',
  year:   2024,
  track:  1,
});

if (modified) {
  const blob = new Blob([modified], { type: 'audio/mpeg' });
  // trigger a download, send to a server, etc.
}
```

### Advanced API — FileRef

Use `FileRef` when you need direct access to tags, audio properties, or
format-specific metadata.

```ts
import { FileRef, ReadStyle } from 'taglib-ts';

const ref = await FileRef.fromBlob(blob, 'track.mp3');

if (ref.isValid) {
  const tag  = ref.tag();
  const ap   = ref.audioProperties();

  console.log(tag?.title, tag?.artist);
  console.log(ap?.sampleRate, ap?.channels);

  // Modify and save
  if (tag) {
    tag.title  = 'Updated Title';
    tag.artist = 'Updated Artist';
  }
  ref.save(); // writes into the in-memory stream

  // Retrieve the modified bytes
  const modified = ref.file()!.stream() as ByteVectorStream;
  const bytes = modified.data().data; // Uint8Array
}
```

---

## API Reference

### Simple API

#### `readTags(input, readAudioProperties?): Promise<Tags>`

Read tags and optionally audio properties from an audio file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `input` | `AudioInput` | — | Audio data (see below) |
| `readAudioProperties` | `boolean` | `true` | Whether to extract audio properties |

**`AudioInput`** can be:
- `File` — browser `File` object; filename is used for format detection
- `Blob` — content-based format detection
- `Uint8Array` — raw bytes; content-based detection
- `{ data: Uint8Array; filename: string }` — raw bytes with explicit filename

**Returns** a `Tags` object:

```ts
interface Tags {
  title:            string;
  artist:           string;
  album:            string;
  comment:          string;
  genre:            string;
  year:             number;   // 0 if not set
  track:            number;   // 0 if not set
  audioProperties:  AudioPropertiesInfo | null;
}

interface AudioPropertiesInfo {
  lengthInSeconds:      number;
  lengthInMilliseconds: number;
  bitrate:              number;  // kb/s
  sampleRate:           number;  // Hz
  channels:             number;
}
```

If the format is not recognised the function returns an object with all string
fields as `""`, numeric fields as `0`, and `audioProperties` as `null`.

---

#### `writeTags(input, tags): Promise<Uint8Array | null>`

Write tags to an audio file and return the modified bytes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `AudioInput` | Audio data to modify (never mutated in place) |
| `tags` | `TagsToWrite` | Fields to update; `undefined` fields are left unchanged |

```ts
interface TagsToWrite {
  title?:   string;
  artist?:  string;
  album?:   string;
  comment?: string;
  genre?:   string;
  year?:    number;
  track?:   number;
}
```

Returns `null` if the format is unknown, the file is invalid, or the save failed.

---

### Advanced API — `FileRef`

`FileRef` is the main entry point for advanced usage.

#### Static factory methods

```ts
// From an IOStream (any custom stream implementing IOStream)
static async open(stream: IOStream, readProperties?: boolean, readStyle?: ReadStyle): Promise<FileRef>

// From a Uint8Array (with optional filename for extension-based detection)
static async fromByteArray(data: Uint8Array, filename?: string, readProperties?: boolean, readStyle?: ReadStyle): Promise<FileRef>

// From a Blob or browser File
static async fromBlob(blob: Blob, filename?: string, readProperties?: boolean, readStyle?: ReadStyle): Promise<FileRef>
```

#### Instance methods & properties

| Member | Returns | Description |
|--------|---------|-------------|
| `isValid` | `boolean` | `true` if the file was parsed successfully |
| `isNull` | `boolean` | `true` if no underlying file is attached |
| `tag()` | `Tag \| null` | The unified tag for this file |
| `audioProperties()` | `AudioProperties \| null` | Stream audio properties |
| `file()` | `File \| null` | The underlying format-specific `File` object |
| `save()` | `boolean` | Save tag changes back to the in-memory stream |
| `properties()` | `PropertyMap` | All tags as a key→string[] map |
| `setProperties(map)` | `PropertyMap` | Set tags from a PropertyMap; returns unsupported keys |
| `complexPropertyKeys()` | `string[]` | Keys with complex (non-string) values (e.g. `PICTURE`) |
| `complexProperties(key)` | `VariantMap[]` | Get complex property values |
| `setComplexProperties(key, value)` | `boolean` | Set complex property values |
| `FileRef.defaultFileExtensions()` | `string[]` | All supported file extensions |

---

### Tag (`Tag`)

The `Tag` abstract class is implemented by all format-specific tag classes
and exposed via `FileRef.tag()` and `readTags()`.

```ts
abstract class Tag {
  // Getters / setters
  abstract title:   string;
  abstract artist:  string;
  abstract album:   string;
  abstract comment: string;
  abstract genre:   string;
  abstract year:    number;
  abstract track:   number;

  // Helpers
  readonly isEmpty: boolean;

  // PropertyMap interface
  properties(): PropertyMap;
  setProperties(map: PropertyMap): PropertyMap;
  complexPropertyKeys(): string[];
  complexProperties(key: string): VariantMap[];
  setComplexProperties(key: string, value: VariantMap[]): boolean;

  // Static utilities
  static duplicate(source: Tag, target: Tag, overwrite: boolean): void;
  static joinTagValues(values: string[]): string;
}
```

---

### AudioProperties (`AudioProperties`)

```ts
abstract class AudioProperties {
  readonly lengthInSeconds:      number;  // rounded to nearest second
  readonly lengthInMilliseconds: number;
  readonly bitrate:              number;  // kb/s
  readonly sampleRate:           number;  // Hz
  abstract readonly channels:    number;
}
```

---

### PropertyMap

A case-insensitive, ordered `Map<string, string[]>` for storing tag key/value pairs.

```ts
const map = new PropertyMap();
map.replace('TITLE',  ['My Song']);
map.replace('ARTIST', ['My Artist', 'Another Artist']);

for (const [key, values] of map.entries()) {
  console.log(key, values);
}
```

---

### Format Detection

```ts
import { detectByExtension, detectByContent } from 'taglib-ts';

const format = detectByExtension('track.mp3');     // 'mpeg'
const format2 = detectByContent(stream);            // null | format string
```

---

## Supported Formats

| Extension(s) | Format | Tags |
|---|---|---|
| `.mp3`, `.mp2`, `.aac` | MPEG Audio | ID3v1, ID3v2, APEv2 |
| `.flac` | FLAC | Vorbis Comment, FLAC Picture |
| `.m4a`, `.m4b`, `.mp4`, `.aax` | MP4/AAC, ALAC | MP4 atoms (iTunes) |
| `.ogg`, `.oga` | OGG Vorbis | Vorbis Comment |
| `.opus` | OGG Opus | Vorbis Comment |
| `.spx` | OGG Speex | Vorbis Comment |
| `.flac` (in OGG) | OGG FLAC | Vorbis Comment |
| `.wav` | WAV / RIFF | ID3v2, RIFF Info |
| `.aif`, `.aiff`, `.aifc` | AIFF | ID3v2 |
| `.mpc` | Musepack (SV4–SV8) | APEv2, ID3v1 |
| `.wv` | WavPack | APEv2, ID3v1 |
| `.ape` | Monkey's Audio | APEv2, ID3v1 |
| `.tta` | TrueAudio | ID3v2, ID3v1 |
| `.dsf` | DSF (DSD) | ID3v2 |
| `.dff`, `.dsdiff` | DSDIFF (DSD) | ID3v2, DIIN |

---

## Streams & Browser Usage

All format readers work on an in-memory `ByteVectorStream`.  There is no file
system access — audio data is passed in as a `Uint8Array` and the (possibly
modified) bytes are returned as a `Uint8Array`.

```ts
import { ByteVectorStream, ByteVector } from 'taglib-ts';

const bv     = ByteVector.fromByteArray(myUint8Array);
const stream = new ByteVectorStream(bv);
const ref    = await FileRef.open(stream);
```

---

## ReadStyle

Control how much of the file is scanned for audio properties:

```ts
import { ReadStyle } from 'taglib-ts';

ReadStyle.Fast     // Minimal scan — may be less accurate
ReadStyle.Average  // Default — good balance of speed and accuracy
ReadStyle.Accurate // Full scan — most accurate bitrate/duration for VBR
```

---

## License

LGPL-2.1-or-later (same as the original C++ TagLib)
