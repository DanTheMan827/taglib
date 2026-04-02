import { describe, expect, it } from "vitest";
import { ApeFooter, ApeItem, ApeItemType, ApeTag } from "../ape/apeTag.js";
import { ByteVectorStream } from "../toolkit/byteVectorStream.js";

describe("APE Tag", () => {
  it("should create empty tag", () => {
    // TypeScript-only test
    const tag = new ApeTag();
    expect(tag.isEmpty).toBe(true);
    expect(tag.title).toBe("");
    expect(tag.artist).toBe("");
  });

  it("should set and get tag properties", () => {
    // TypeScript-only test
    const tag = new ApeTag();
    tag.title = "Test Title";
    tag.artist = "Test Artist";
    tag.album = "Test Album";
    tag.comment = "Test Comment";
    tag.genre = "Rock";
    tag.year = 2023;
    tag.track = 5;

    expect(tag.title).toBe("Test Title");
    expect(tag.artist).toBe("Test Artist");
    expect(tag.album).toBe("Test Album");
    expect(tag.comment).toBe("Test Comment");
    expect(tag.genre).toBe("Rock");
    expect(tag.year).toBe(2023);
    expect(tag.track).toBe(5);
    expect(tag.isEmpty).toBe(false);
  });

  it("should manage items", () => {
    // TypeScript-only test
    const tag = new ApeTag();

    const item = new ApeItem();
    item.key = "Title";
    item.values = ["Test"];
    item.type = ApeItemType.Text;

    tag.setItem(item);
    expect(tag.item("Title")).toBeDefined();
    expect(tag.item("Title")?.values[0]).toBe("Test");

    tag.removeItem("Title");
    expect(tag.item("Title")).toBeUndefined();
  });

  it("should render and parse items", () => {
    // TypeScript-only test
    const item = new ApeItem();
    item.key = "Title";
    item.values = ["Hello World"];
    item.type = ApeItemType.Text;

    const rendered = item.render();
    expect(rendered.length).toBeGreaterThan(0);

    const parsed = ApeItem.parse(rendered, 0);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.item.key).toBe("Title");
      expect(parsed.item.values[0]).toBe("Hello World");
    }
  });

  it("should handle footer", () => {
    // TypeScript-only test
    const footer = new ApeFooter();
    footer.version = 2000;
    footer.itemCount = 3;
    footer.tagSize = 100;

    const rendered = footer.render();
    expect(rendered.length).toBe(ApeFooter.SIZE);

    const parsed = ApeFooter.parse(rendered);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.version).toBe(2000);
      expect(parsed.itemCount).toBe(3);
      expect(parsed.tagSize).toBe(100);
    }
  });

  it("should render and re-parse full tag", async () => {
    // TypeScript-only test
    const tag = new ApeTag();
    tag.title = "Render Test";
    tag.artist = "Artist";
    tag.album = "Album";
    tag.year = 2020;
    tag.track = 3;
    tag.genre = "Pop";

    const rendered = tag.render();
    expect(rendered.length).toBeGreaterThan(0);

    // Parse back - create a stream with the rendered data
    const stream = new ByteVectorStream(rendered);
    // Footer is at the end
    const footerOffset = rendered.length - ApeFooter.SIZE;
    const parsed = await ApeTag.readFrom(stream, footerOffset);

    expect(parsed.title).toBe("Render Test");
    expect(parsed.artist).toBe("Artist");
    expect(parsed.album).toBe("Album");
    expect(parsed.year).toBe(2020);
    expect(parsed.track).toBe(3);
    expect(parsed.genre).toBe("Pop");
  });

  it("should handle properties", () => {
    // TypeScript-only test
    const tag = new ApeTag();
    tag.title = "Prop Test";
    tag.artist = "Prop Artist";

    const props = tag.properties();
    expect(props.get("TITLE")).toEqual(["Prop Test"]);
    expect(props.get("ARTIST")).toEqual(["Prop Artist"]);
  });
});
