// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { RESOURCE_CATEGORIES } from "../../resources/rules.ts";
import * as S from "./brand-schemas.ts";

test("the brand vocabulary matches lib/hq/resources", () => {
  assert.deepEqual([...S.BRAND_CATEGORY_VALUES], [...RESOURCE_CATEGORIES]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("there are three tools and every field is described", () => {
  assert.equal(shapes.length, 3);
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

test("list_brand_resources: optional category, search words and page", () => {
  const list = z.object(S.listBrandResourcesShape);
  assert.equal(list.safeParse({}).success, true);
  assert.equal(list.safeParse({ category: "logos", search: "lockup", page: 2 }).success, true);
  assert.equal(list.safeParse({ category: "secret" }).success, false);
  assert.equal(list.safeParse({ search: "a" }).success, false, "search needs at least two characters");
  assert.equal(list.safeParse({ search: "x".repeat(101) }).success, false);
  assert.equal(list.safeParse({ page: 0 }).success, false);
  assert.equal(list.safeParse({ page: 41 }).success, false);
  assert.equal(list.safeParse({ page: 1.5 }).success, false);
  assert.equal(list.safeParse({ search: "  RES-0007  " }).data?.search, "RES-0007", "trimmed");
});

test("get_brand_resource: a resource (number, id or title words) and an optional offset", () => {
  const get = z.object(S.getBrandResourceShape);
  assert.equal(get.safeParse({}).success, false, "a resource is required");
  assert.equal(get.safeParse({ resource: "" }).success, false);
  assert.equal(get.safeParse({ resource: "RES-0007" }).success, true);
  assert.equal(get.safeParse({ resource: "Primary lockup, forest", offset: 9000 }).success, true);
  assert.equal(get.safeParse({ resource: "x", offset: -1 }).success, false);
  assert.equal(get.safeParse({ resource: "x", offset: 60_001 }).success, false);
  assert.equal(get.safeParse({ resource: "x".repeat(201) }).success, false);
});

test("get_brand_summary takes no arguments", () => {
  assert.deepEqual(Object.keys(S.getBrandSummaryShape), []);
  assert.equal(z.object(S.getBrandSummaryShape).safeParse({}).success, true);
});
