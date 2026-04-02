import { describe, expect, it } from "vitest";
import { ByteVector, StringType } from "../byteVector.js";
import { Variant, VariantType } from "../toolkit/variant.js";

describe("Variant", () => {
  it("should create void variant", () => {
    // TypeScript-only test
    const v = Variant.fromVoid();
    expect(v.type()).toBe(VariantType.Void);
    expect(v.isEmpty()).toBe(true);
  });

  it("should create and retrieve bool", () => {
    // TypeScript-only test
    const v = Variant.fromBool(true);
    expect(v.type()).toBe(VariantType.Bool);
    expect(v.isEmpty()).toBe(false);
    expect(v.toBool()).toBe(true);
  });

  it("should create and retrieve int", () => {
    // TypeScript-only test
    const v = Variant.fromInt(-4);
    expect(v.type()).toBe(VariantType.Int);
    expect(v.isEmpty()).toBe(false);
    expect(v.toInt()).toBe(-4);
  });

  it("should create and retrieve uint", () => {
    // TypeScript-only test
    const v = Variant.fromUInt(5);
    expect(v.type()).toBe(VariantType.UInt);
    expect(v.toInt()).toBe(5); // UInt can be read as Int
  });

  it("should create and retrieve longlong", () => {
    // TypeScript-only test
    const v = Variant.fromLongLong(-6n);
    expect(v.type()).toBe(VariantType.LongLong);
    expect(v.toLongLong()).toBe(-6n);
  });

  it("should create and retrieve ulonglong", () => {
    // TypeScript-only test
    const v = Variant.fromULongLong(7n);
    expect(v.type()).toBe(VariantType.ULongLong);
    expect(v.toLongLong()).toBe(7n); // ULongLong via toLongLong
  });

  it("should create and retrieve double", () => {
    // TypeScript-only test
    const v = Variant.fromDouble(1.23);
    expect(v.type()).toBe(VariantType.Double);
    expect(v.toDouble()).toBeCloseTo(1.23, 10);
  });

  it("should create and retrieve string", () => {
    // TypeScript-only test
    const v = Variant.fromString("test");
    expect(v.type()).toBe(VariantType.String);
    expect(v.toString()).toBe("test");
  });

  it("should create and retrieve string list", () => {
    // TypeScript-only test
    const v = Variant.fromStringList(["el0", "el"]);
    expect(v.type()).toBe(VariantType.StringList);
    expect(v.toStringList()).toEqual(["el0", "el"]);
  });

  it("should create and retrieve byte vector", () => {
    // TypeScript-only test
    const bv = ByteVector.fromString("data", StringType.Latin1);
    const v = Variant.fromByteVector(bv);
    expect(v.type()).toBe(VariantType.ByteVector);
    expect(v.toByteVector().equals(bv)).toBe(true);
  });

  it("should create and retrieve byte vector list", () => {
    // TypeScript-only test
    const bv1 = ByteVector.fromString("first", StringType.Latin1);
    const bv2 = ByteVector.fromString("second", StringType.Latin1);
    const v = Variant.fromByteVectorList([bv1, bv2]);
    expect(v.type()).toBe(VariantType.ByteVectorList);
    const list = v.toByteVectorList();
    expect(list.length).toBe(2);
    expect(list[0].equals(bv1)).toBe(true);
  });

  it("should create and retrieve variant list", () => {
    // TypeScript-only test
    const v = Variant.fromList([Variant.fromString("1st"), Variant.fromString("2nd")]);
    expect(v.type()).toBe(VariantType.VariantList);
    const list = v.toList();
    expect(list.length).toBe(2);
    expect(list[0].toString()).toBe("1st");
  });

  it("should create and retrieve variant map", () => {
    // TypeScript-only test
    const map = new Map<string, Variant>();
    map.set("key1", Variant.fromString("value1"));
    map.set("key2", Variant.fromString("value2"));
    const v = Variant.fromMap(map);
    expect(v.type()).toBe(VariantType.VariantMap);
    expect(v.toMap().get("key1")?.toString()).toBe("value1");
  });
});
