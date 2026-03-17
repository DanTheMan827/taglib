# AGENTS.md — AI Agent Documentation

This document describes the structure, style, and conventions of the taglib-ts
repository. It is intended for AI coding agents and contributors who need to
understand the codebase quickly.

## Repository Overview

**taglib-ts** is a pure TypeScript port of the C++ [TagLib](https://taglib.org/)
library. It reads and writes audio metadata (tags) for 21+ container formats in
any JavaScript runtime (browsers, Node.js, Deno, Bun) — no WASM or native code
required.

## Directory Layout

```
src/                    ← TypeScript source (one subdirectory per format family)
  toolkit/              ← Core utilities (IOStream, ByteVectorStream, types)
  ape/                  ← APE tag + APE (Monkey's Audio) file format
  asf/                  ← ASF / WMA format
  dsdiff/               ← DSDIFF format
  dsf/                  ← DSF format
  flac/                 ← FLAC format
  it/                   ← Impulse Tracker format
  matroska/             ← Matroska / WebM format
  mod/                  ← MOD tracker format
  mp4/                  ← MP4 / AAC / ALAC format
  mpc/                  ← Musepack format
  mpeg/                 ← MPEG (MP3) format
  ogg/                  ← OGG container (Vorbis, Opus, Speex, FLAC sub-formats)
  riff/                 ← RIFF container (WAV, AIFF)
  s3m/                  ← ScreamTracker 3 format
  shorten/              ← Shorten format
  trueaudio/            ← TrueAudio format
  wavpack/              ← WavPack format
  xm/                   ← Extended Module format
  byteVector.ts         ← Binary data container (core)
  tag.ts                ← Abstract Tag base class
  audioProperties.ts    ← Abstract AudioProperties base class
  file.ts               ← Abstract File base class
  combinedTag.ts        ← Priority-based multi-tag delegator
  fileRef.ts            ← Format-agnostic entry point (dynamic imports)
  formatDetection.ts    ← Extension/content-based format detection (no imports)
  simpleApi.ts          ← High-level readTags()/writeTags() API
  index.ts              ← Public API barrel exports
tests/                  ← vitest test files
  data/                 ← Binary test fixtures (audio files)
  testHelper.ts         ← Shared test utilities
  *.test.ts             ← Test suites
examples/               ← TypeScript usage examples
.github/workflows/      ← CI workflow files
```

## Key Conventions

### File Naming
- Source files: `camelCase.ts` (e.g., `mpegFile.ts`, `byteVector.ts`)
- Test files: `camelCase.test.ts` (e.g., `fileRef.test.ts`)
- One class per file; filename matches the primary export

### Import Style
- Relative imports with `.js` extension: `import { Foo } from './foo.js'`
- Type-only imports where possible: `import type { Bar } from './bar.js'`
- Dynamic `import()` in `fileRef.ts` for code splitting

### Class Patterns
- **File classes** extend `File` (abstract base) — constructor takes
  `(stream: IOStream, readProperties?: boolean, readStyle?: ReadStyle)`
- **Tag classes** extend `Tag` — provide property getters/setters and
  `properties()` / `setProperties()` for PropertyMap access
- **Properties classes** extend `AudioProperties` — read-only audio info
- All stream I/O goes through the `IOStream` interface; the in-memory
  implementation is `ByteVectorStream`

### Binary Data
- Use `ByteVector` for binary buffers (not raw `Uint8Array`)
- Integer conversions: `.toUInt()`, `.toShort()`, `.toLongLong()` etc.
- String conversions: `.toString(StringType.Latin1)`, `.toString(StringType.UTF8)`
- Byte-by-byte access: `.get(i)`, `.mid(offset, length)`

### Format Detection
- Extension-based detection in `detectByExtension()`
- Content-based detection in `detectByContent()`
- Both live in `formatDetection.ts` with **no imports of format classes**
  to enable tree-shaking / code splitting
- MPEG detection is always last (frame sync bytes cause false positives)

### Testing
- Use `vitest` — `npm test` runs all tests
- Test helpers in `tests/testHelper.ts`:
  - `readTestData(filename)` → `Uint8Array`
  - `openTestStream(filename)` → `ByteVectorStream`
  - `readTestDataBV(filename)` → `ByteVector`
- Binary test data lives in `tests/data/`
- Name tests after the C++ test file they port (e.g., `test_fileref.cpp` → `fileRef.test.ts`)

### Adding a New Format

1. Create `src/<format>/` directory with at minimum:
   - `<format>File.ts` — extends `File`
   - `<format>Properties.ts` — extends `AudioProperties`
   - `<format>Tag.ts` — extends `Tag` (or reuse existing tag types)
2. Add extension mapping in `formatDetection.ts` → `detectByExtension()`
3. Add content detection in `formatDetection.ts` → `detectByContent()`
4. Add dynamic import case in `fileRef.ts` → `instantiateFormat()`
5. Add exports in `index.ts`
6. Add the extension(s) to `defaultFileExtensions()` in `formatDetection.ts`
7. Write tests in `tests/<format>.test.ts`
8. Add test data files to `tests/data/`

### Code Style
- ESLint with `@stylistic/eslint-plugin` for formatting
- Double quotes, semicolons, 2-space indentation
- Trailing commas in multiline
- `npm run lint` to check, `npm run format` to auto-fix

### CI
- GitHub Actions workflow at `.github/workflows/build.yml`
- Runs on Node 20 and 22
- Steps: install → type check → build → test

## API Layers

1. **Simple API** (`readTags` / `writeTags`) — fire-and-forget, returns plain
   objects, suitable for most use cases
2. **FileRef** — format-agnostic handle with `tag()`, `save()`,
   `properties()`, `complexProperties()` etc.
3. **Format-specific classes** — direct access to e.g. `MpegFile`, `FlacFile`,
   `Mp4Tag` for advanced use.

## TypeScript Configuration
- `target: ES2022`, `module: NodeNext`
- Strict mode enabled
- Output to `dist/`

## Documentation
- The npm package name is `@dantheman827/taglib-ts`
- All TypeScript files must have an `@file` comment describing the purpose of the file.
- All classes, methods, properties, and variables must have tsdoc tags regardless of if they're public or not.
- Examples must always be accurate to the current state of the code.
- The AGENTS.md must remain current as changes are made to the project structure.
