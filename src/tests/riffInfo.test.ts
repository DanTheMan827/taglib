import { describe, expect, it } from "vitest";
import { RiffInfoTag } from "../riff/infoTag.js";

describe("RIFF Info Tag", () => {
  it("should create empty tag", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    expect(tag.isEmpty).toBe(true);
    expect(tag.title).toBe("");
    expect(tag.artist).toBe("");
  });

  it("should set and get title", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.title = "Test Title";
    expect(tag.title).toBe("Test Title");
  });

  it("should set and get artist", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.artist = "Test Artist";
    expect(tag.artist).toBe("Test Artist");
  });

  it("should set and get album", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.album = "Test Album";
    expect(tag.album).toBe("Test Album");
  });

  it("should set and get comment", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.comment = "Test Comment";
    expect(tag.comment).toBe("Test Comment");
  });

  it("should set and get genre", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.genre = "Rock";
    expect(tag.genre).toBe("Rock");
  });

  it("should set and get year", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.year = 2023;
    expect(tag.year).toBe(2023);
  });

  it("should set and get track", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.track = 7;
    expect(tag.track).toBe(7);
  });

  it("should handle field text directly", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.setFieldText("ISFT", "Test Software");
    expect(tag.fieldText("ISFT")).toBe("Test Software");
  });

  it("should render and re-parse", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.title = "Render Test";
    tag.artist = "Artist";
    tag.album = "Album";

    const rendered = tag.render();
    expect(rendered.length).toBeGreaterThan(0);

    const parsed = RiffInfoTag.readFrom(rendered);
    expect(parsed.title).toBe("Render Test");
    expect(parsed.artist).toBe("Artist");
    expect(parsed.album).toBe("Album");
  });

  it("should handle properties", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.title = "Prop Test";
    tag.artist = "Prop Artist";

    const props = tag.properties();
    expect(props.get("TITLE")).toEqual(["Prop Test"]);
    expect(props.get("ARTIST")).toEqual(["Prop Artist"]);
  });

  it("should not be empty when fields are set", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.title = "Test";
    expect(tag.isEmpty).toBe(false);
  });

  it("should remove field", () => {
    // TypeScript-only test
    const tag = new RiffInfoTag();
    tag.title = "Test";
    tag.removeField("INAM");
    expect(tag.title).toBe("");
  });
});
