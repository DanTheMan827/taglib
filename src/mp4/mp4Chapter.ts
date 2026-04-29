/** @packageDocumentation MP4 chapter types shared by Nero and QuickTime chapter implementations. */

/**
 * A single chapter marker for an MP4 file.
 *
 * Start times are in **milliseconds**, matching C++ TagLib's `Chapter::startTime()` units.
 */
export interface Mp4Chapter {
  /** Chapter title (UTF-8 string). */
  title: string;
  /** Chapter start time in milliseconds (non-negative). */
  startTime: number;
}

/**
 * Checks if two {@link Mp4Chapter} arrays are equal (same length, same
 * titles and start times in the same order).
 *
 * @param a - First chapter list.
 * @param b - Second chapter list.
 * @returns `true` if the lists are equal.
 */
export function chaptersEqual(a: Mp4Chapter[], b: Mp4Chapter[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].title !== b[i].title || a[i].startTime !== b[i].startTime) return false;
  }
  return true;
}

/**
 * Abstract base class for chapter list holders.
 *
 * Implements the lazy-read / dirty-write pattern used by both Nero and
 * QuickTime chapter implementations:
 * - Chapters are read from disk only on first access.
 * - Chapters are written to disk only when they have been modified.
 */
export abstract class Mp4ChapterHolder {
  /** The currently-held chapter list (may not yet be loaded from disk). */
  protected _chapters: Mp4Chapter[] = [];
  /** Whether the in-memory chapter list differs from what is on disk. */
  protected _modified = false;
  /** Whether chapters have been loaded from disk at least once. */
  protected _loaded = false;

  /**
   * Returns the current chapter list, loading from disk on first call.
   *
   * @param stream - The file stream to read from (used only on first call).
   * @returns The chapter list.
   */

  abstract getChapters(stream: any): Promise<Mp4Chapter[]>;

  /**
   * Reads chapters from disk into `_chapters`.
   *
   * @param stream - The file stream.
   * @returns `true` if chapters were found on disk.
   */

  abstract read(stream: any): Promise<boolean>;

  /**
   * Writes `_chapters` to disk.
   *
   * @param stream - The file stream.
   * @returns `true` on success.
   */

  abstract write(stream: any): Promise<boolean>;

  /**
   * Returns `true` if the in-memory chapter list has been modified.
   */
  get isModified(): boolean {
    return this._modified;
  }

  /**
   * Sets `_modified` directly (used in tests / mock subclasses).
   *
   * @param value - New modified state.
   */
  setModified(value: boolean): void {
    this._modified = value;
  }

  /**
   * Updates the chapter list, marking it as modified if the new list
   * differs from the current one or if the holder was not yet loaded.
   *
   * @param chapters - Replacement chapter list.
   */
  setChapters(chapters: Mp4Chapter[]): void {
    if (!this._loaded) {
      // Set before any read – always dirty.
      this._chapters = chapters;
      this._modified = true;
      this._loaded = true;
    } else if (this._modified || !chaptersEqual(this._chapters, chapters)) {
      this._chapters = chapters;
      this._modified = true;
    }
  }

  /**
   * Returns the held chapter list without triggering a disk read.
   * Useful for mock implementations in tests.
   */
  chapters(): Mp4Chapter[] {
    return this._chapters;
  }

  /**
   * Writes the chapter list to disk only if it has been modified.
   *
   * @param stream - The file stream.
   * @returns `true` if successful (or if no write was needed).
   */
  async saveIfModified(stream: Parameters<typeof this.write>[0]): Promise<boolean> {
    if (this._modified) {
      if (await this.write(stream)) {
        this._modified = false;
        return true;
      }
      return false;
    }
    return true;
  }
}
