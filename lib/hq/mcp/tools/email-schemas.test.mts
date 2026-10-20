// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { EMAIL_TEMPLATES } from "../../email/rules.ts";
import * as S from "./email-schemas.ts";

test("the email template vocabulary matches lib/hq/email/rules.ts", () => {
  assert.deepEqual([...S.EMAIL_TEMPLATE_VALUES], [...EMAIL_TEMPLATES]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every email tool field is described", () => {
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

test("no email tool takes an address to send to, cc or bcc", () => {
  for (const [name, shape] of shapes) {
    for (const field of Object.keys(shape)) assert.doesNotMatch(field, /^(to|to_email|email|address|cc|bcc|recipients)$/, `${name}.${field}`);
  }
  const draft = z.object(S.draftEmailShape).strict();
  assert.equal(draft.safeParse({ recipient: "Tim", template: "thank_you", subject: "Hi", body: "Hi Tim", cc: "x@y.test" }).success, false);
});

test("the email schemas refuse what the database would", () => {
  const draft = z.object(S.draftEmailShape);
  assert.equal(draft.safeParse({ recipient: "Tim Hosking", template: "thank_you", subject: "Thank you", body: "Hi Tim" }).success, true);
  assert.equal(draft.safeParse({ recipient: "Tim Hosking", template: "spam", subject: "Thank you", body: "Hi Tim" }).success, false);
  assert.equal(draft.safeParse({ recipient: "Tim Hosking", template: "general", subject: "s".repeat(201), body: "Hi" }).success, false);
  assert.equal(draft.safeParse({ recipient: "Tim Hosking", template: "general", subject: "s", body: "b".repeat(8001) }).success, false);
  assert.equal(draft.safeParse({ recipient: "", template: "general", subject: "s", body: "b" }).success, false);
});
