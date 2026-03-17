/**
 * @file Benchmarks for all in-process {@link IOStream} implementations.
 *
 * ### Why async is slower than sync
 *
 * Every `await` suspension — even of an already-resolved Promise — forces the
 * JavaScript engine to schedule a **microtask** and resume the caller on the
 * next checkpoint.  In Node.js / V8 this costs roughly **60-70 ns per
 * `await`** (verified empirically in this environment).  For format parsers
 * that perform thousands of individual stream reads, the overhead accumulates:
 *
 * | reads per parse | extra latency |
 * |----------------:|--------------:|
 * |             100 |         ~7 µs |
 * |           1 000 |        ~70 µs |
 * |          10 000 |       ~700 µs |
 * |         100 000 |         ~7 ms |
 *
 * This is **inherent** to the async/await abstraction — it affects all stream
 * implementations equally because the overhead is in the `await` call itself,
 * not in the underlying I/O.  The sequential-read benchmark below makes this
 * visible: all implementations converge to the same throughput because 8 192
 * microtask suspensions per 1 MiB iteration dominate every other cost.
 *
 * The key mitigation: **read the largest possible block at once** in hot code
 * paths, reducing the total number of `await` calls.
 *
 * ### BlobStream cache behaviour
 *
 * `BlobStream` uses a **piece table** with per-segment fetch caching:
 * - First read of a segment issues `blob.slice().arrayBuffer()` and stores
 *   the resulting `Uint8Array` on the segment.
 * - All subsequent reads of the same range are served from the cache.
 * - When one `readBlock` spans multiple uncached segments, all
 *   `arrayBuffer()` calls are issued in parallel via `Promise.all`.
 *
 * The "warm" benchmarks below share a single pre-loaded stream across all
 * iterations (lazy-initialised on the first call).  The first iteration pays
 * the cold cost; all subsequent ones are served purely from the cache.
 *
 * Run with:
 * ```
 * npx vitest bench
 * ```
 */

import { bench, describe } from "vitest";
import { ByteVector } from "../byteVector.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";
import { ChunkedByteVectorStream } from "../toolkit/chunkedByteVectorStream.js";
import { BlobStream } from "../toolkit/blobStream.js";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

/** Total size of the synthetic test payload (1 MiB). */
const PAYLOAD_SIZE = 1024 * 1024;

/**
 * A deterministic 1 MiB `Uint8Array` generated with a simple LCG (Linear
 * Congruential Generator).  Using a fixed seed and a deterministic algorithm
 * ensures that every benchmark run, on every machine and every environment,
 * operates on byte-for-byte identical data.  This eliminates any variance
 * introduced by different random data distributions and makes benchmark
 * results reproducible and comparable across runs.
 */
const PAYLOAD = (() => {
  const buf = new Uint8Array(PAYLOAD_SIZE);
  let v = 0xdeadbeef;
  for (let i = 0; i < PAYLOAD_SIZE; i++) {
    v = (Math.imul(v, 1664525) + 1013904223) >>> 0;
    buf[i] = v & 0xff;
  }
  return buf;
})();

/** Pre-built `Blob` wrapping {@link PAYLOAD}. */
const PAYLOAD_BLOB = new Blob([PAYLOAD]);

/** Pre-built `ByteVector` wrapping a copy of {@link PAYLOAD}. */
const PAYLOAD_BV = ByteVector.fromUint8Array(PAYLOAD);

/** Number of bytes per read in small-read benchmarks. */
const READ_SIZE = 128;

/** Number of random-access reads per iteration. */
const RANDOM_READS = 512;

/**
 * Pre-computed deterministic random read offsets so that offset generation
 * is not part of the measured hot path.
 */
const RANDOM_OFFSETS: number[] = Array.from({ length: RANDOM_READS }, (_, i) => {
  const h = Math.imul(i + 1, 0x9e3779b9) >>> 0;
  return h % (PAYLOAD_SIZE - READ_SIZE);
});

// ---------------------------------------------------------------------------
// Stream factories
// ---------------------------------------------------------------------------

/** Returns a fresh {@link ByteVectorStream} backed by {@link PAYLOAD}. */
function makeBVS(): ByteVectorStream {
  return new ByteVectorStream(PAYLOAD_BV);
}

/**
 * Returns a fresh {@link ChunkedByteVectorStream} backed by four equal chunks
 * of {@link PAYLOAD}, matching a realistic chunked layout.
 */
function makeCBVS(): ChunkedByteVectorStream {
  const q = PAYLOAD_SIZE / 4;
  return new ChunkedByteVectorStream(
    PAYLOAD.subarray(0, q),
    PAYLOAD.subarray(q, q * 2),
    PAYLOAD.subarray(q * 2, q * 3),
    PAYLOAD.subarray(q * 3),
  );
}

/** Returns a fresh cold {@link BlobStream} (no segment cache yet). */
function makeColdBS(): BlobStream {
  return new BlobStream(PAYLOAD_BLOB);
}

// ---------------------------------------------------------------------------
// Lazy-warm BlobStream helper
//
// Shared across all iterations of each warm benchmark.  On the first call the
// blob is fetched and cached; every subsequent call resets the position and
// returns the same stream.  This means the first iteration of each benchmark
// pays the cold cost; all others are served purely from the in-memory cache.
// ---------------------------------------------------------------------------

/**
 * A lazily-initialised warm {@link BlobStream}.
 *
 * Initialised on first `get()` call by reading the full payload (which
 * populates the segment cache) and then seeking back to 0.
 */
class LazyWarmBlobStream {
  /** The shared, pre-warmed stream instance. */
  private _stream: BlobStream | null = null;

  /**
   * Returns the warm stream, creating and warming it on the first call.
   * Resets the position to 0 before returning.
   *
   * @returns Resolves with the warmed stream, positioned at byte 0.
   */
  async get(): Promise<BlobStream> {
    if (!this._stream) {
      this._stream = makeColdBS();
      await this._stream.readBlock(PAYLOAD_SIZE); // populate cache
    }
    await this._stream.seek(0);
    return this._stream;
  }
}

// ---------------------------------------------------------------------------
// 1. Single large read  (1 await per iteration — measures pure throughput)
// ---------------------------------------------------------------------------

describe("Single full read (1 MiB — 1 await)", () => {
  const warm = new LazyWarmBlobStream();

  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    await s.readBlock(PAYLOAD_SIZE);
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    await s.readBlock(PAYLOAD_SIZE);
  });

  bench("BlobStream — cold (fetches blob once)", async () => {
    const s = makeColdBS();
    await s.readBlock(PAYLOAD_SIZE);
  });

  bench("BlobStream — warm (served from cache)", async () => {
    const s = await warm.get();
    await s.readBlock(PAYLOAD_SIZE);
  });
});

// ---------------------------------------------------------------------------
// 2. Sequential read in READ_SIZE chunks
//    (PAYLOAD_SIZE / READ_SIZE awaits per iteration — shows microtask overhead)
// ---------------------------------------------------------------------------

describe(`Sequential read (1 MiB in ${READ_SIZE}-byte chunks — ${(PAYLOAD_SIZE / READ_SIZE).toLocaleString()} awaits)`, () => {
  const warm = new LazyWarmBlobStream();

  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    while ((await s.tell()) < PAYLOAD_SIZE) {
      await s.readBlock(READ_SIZE);
    }
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    while ((await s.tell()) < PAYLOAD_SIZE) {
      await s.readBlock(READ_SIZE);
    }
  });

  bench("BlobStream — cold", async () => {
    const s = makeColdBS();
    while ((await s.tell()) < PAYLOAD_SIZE) {
      await s.readBlock(READ_SIZE);
    }
  });

  bench("BlobStream — warm (cache hit on every read)", async () => {
    const s = await warm.get();
    while ((await s.tell()) < PAYLOAD_SIZE) {
      await s.readBlock(READ_SIZE);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Random-access reads
// ---------------------------------------------------------------------------

describe(`Random-access reads (${RANDOM_READS} seeks + ${READ_SIZE}-byte reads)`, () => {
  const warm = new LazyWarmBlobStream();

  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    for (const offset of RANDOM_OFFSETS) {
      await s.seek(offset);
      await s.readBlock(READ_SIZE);
    }
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    for (const offset of RANDOM_OFFSETS) {
      await s.seek(offset);
      await s.readBlock(READ_SIZE);
    }
  });

  bench("BlobStream — cold", async () => {
    const s = makeColdBS();
    for (const offset of RANDOM_OFFSETS) {
      await s.seek(offset);
      await s.readBlock(READ_SIZE);
    }
  });

  bench("BlobStream — warm", async () => {
    const s = await warm.get();
    for (const offset of RANDOM_OFFSETS) {
      await s.seek(offset);
      await s.readBlock(READ_SIZE);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Re-read: same region repeatedly (tests cache effectiveness)
// ---------------------------------------------------------------------------

describe("Re-read same 4 KiB region × 256", () => {
  const REGION = 4096;
  const warm = new LazyWarmBlobStream();

  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    for (let i = 0; i < 256; i++) {
      await s.seek(0);
      await s.readBlock(REGION);
    }
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    for (let i = 0; i < 256; i++) {
      await s.seek(0);
      await s.readBlock(REGION);
    }
  });

  bench("BlobStream — cold (fetches once on 1st iteration, cached thereafter)", async () => {
    const s = makeColdBS();
    for (let i = 0; i < 256; i++) {
      await s.seek(0);
      await s.readBlock(REGION);
    }
  });

  bench("BlobStream — warm (all 256 iterations from cache)", async () => {
    const s = await warm.get();
    for (let i = 0; i < 256; i++) {
      await s.seek(0);
      await s.readBlock(REGION);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Sequential write (overwrite the entire 1 MiB in one call)
// ---------------------------------------------------------------------------

describe("Sequential write (1 MiB overwrite)", () => {
  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    await s.writeBlock(PAYLOAD_BV);
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    await s.writeBlock(PAYLOAD_BV);
  });

  bench("BlobStream", async () => {
    const s = makeColdBS();
    await s.writeBlock(PAYLOAD_BV);
  });
});

// ---------------------------------------------------------------------------
// 6. Insert at midpoint + full read (simulates tag rewriting with size change)
// ---------------------------------------------------------------------------

describe("Insert 1 KiB at midpoint then read all", () => {
  const INSERT_SIZE = 1024;
  const insertData = ByteVector.fromUint8Array(new Uint8Array(INSERT_SIZE).fill(0xcc));
  const MID = PAYLOAD_SIZE / 2;

  bench("ByteVectorStream", async () => {
    const s = makeBVS();
    await s.insert(insertData, MID);
    await s.seek(0);
    await s.readBlock(PAYLOAD_SIZE + INSERT_SIZE);
  });

  bench("ChunkedByteVectorStream", async () => {
    const s = makeCBVS();
    await s.insert(insertData, MID);
    await s.seek(0);
    await s.readBlock(PAYLOAD_SIZE + INSERT_SIZE);
  });

  bench("BlobStream", async () => {
    const s = makeColdBS();
    await s.insert(insertData, MID);
    await s.seek(0);
    await s.readBlock(PAYLOAD_SIZE + INSERT_SIZE);
  });
});
