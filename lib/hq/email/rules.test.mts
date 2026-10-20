// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMAIL_STATUSES,
  EMAIL_TEMPLATES,
  emailDbMessage,
  emailRef,
  normaliseBody,
  normaliseSubject,
  parseDailyLimit,
  parseEmailRef,
  readEmailSettings,
  sendErrorText,
  templateStart,
  validateEmailFields,
} from "./rules.ts";

const migration = readFileSync(new URL("../../../supabase/migrations/0132_hq_email.sql", import.meta.url), "utf8");

test("the vocabulary matches the database enums", () => {
  assert.match(migration, new RegExp(`create type hq.email_template as enum \\(${EMAIL_TEMPLATES.map((t) => `'${t}'`).join(", ")}\\)`));
  assert.match(migration, new RegExp(`create type hq.email_status as enum \\(${EMAIL_STATUSES.map((t) => `'${t}'`).join(", ")}\\)`));
});

test("EML numbers", () => {
  assert.equal(emailRef(7), "EML-0007");
  assert.equal(emailRef(12345), "EML-12345");
  assert.equal(parseEmailRef("eml-0007"), 7);
  assert.equal(parseEmailRef("EML 12"), 12);
  assert.equal(parseEmailRef("DEC-0001"), null);
});

test("subject and body are cleaned the way the database cleans them", () => {
  assert.equal(normaliseSubject("  Thank\r\nyou   for\ttoday "), "Thank you for today");
  assert.equal(normaliseBody("\r\n Hi,\r\n\r\nThanks.\u0007 \n\n"), "Hi,\n\nThanks.");
});

test("validation: subject 1..200, message 1..8000, a known template", () => {
  assert.deepEqual(validateEmailFields({ subject: "Hi", body: "Body", template: "thank_you" }).errors, {});
  const bad = validateEmailFields({ subject: " ", body: "", template: "spam" }).errors;
  assert.deepEqual(Object.keys(bad).sort(), ["body", "subject", "template"]);
  assert.ok(validateEmailFields({ subject: "s".repeat(201), body: "b", template: "general" }).errors.subject);
  assert.equal(validateEmailFields({ subject: "s".repeat(200), body: "b".repeat(8000), template: "general" }).errors.subject, undefined);
  assert.ok(validateEmailFields({ subject: "s", body: "b".repeat(8001), template: "general" }).errors.body);
});

test("a template starts with a greeting and a suggested subject, and never adds facts", () => {
  assert.deepEqual(templateStart("thank_you", "Tim Hosking"), { subject: "Thank you", body: "Hi Tim,\n\n" });
  assert.deepEqual(templateStart("general", ""), { subject: "", body: "Hi,\n\n" });
  for (const t of EMAIL_TEMPLATES) {
    const s = templateStart(t, "Tim Hosking");
    assert.doesNotMatch(s.subject + s.body, /\d|\$|\[|\]|guarantee|free|promise/i, t);
  }
});

test("settings: the daily limit is a whole number from 1 to 200; chat sending is only exactly true", () => {
  assert.equal(parseDailyLimit("20"), 20);
  assert.equal(parseDailyLimit(200), 200);
  assert.equal(parseDailyLimit("0"), null);
  assert.equal(parseDailyLimit("201"), null);
  assert.equal(parseDailyLimit("2.5"), null);
  assert.deepEqual(readEmailSettings(new Map()), { dailyLimit: 20, chatSend: false });
  assert.deepEqual(readEmailSettings(new Map<string, unknown>([["email_daily_limit", 5], ["email_chat_send_enabled", "true"]])), { dailyLimit: 5, chatSend: false });
  assert.deepEqual(readEmailSettings(new Map<string, unknown>([["email_chat_send_enabled", true]])), { dailyLimit: 20, chatSend: true });
});

test("database refusals in words: rule messages shown, anything else generic", () => {
  const generic = "Something went wrong.";
  assert.equal(emailDbMessage({ code: "42501", message: "this email has not been approved: open it in HQ and tap Approve and send", hint: "email_not_approved" }, generic), "This email has not been approved: open it in HQ and tap Approve and send.");
  assert.equal(emailDbMessage({ code: "42501", message: "permission denied" }, generic), "You don't have permission to do that.");
  assert.equal(emailDbMessage({ code: "54000", message: "daily email limit reached (20 per person per day)" }, generic), "Daily email limit reached (20 per person per day).");
  assert.equal(emailDbMessage({ code: "P0002", message: "email draft not found" }, generic), "That email could not be found.");
  assert.equal(emailDbMessage({ code: "XX000", message: "internal detail alice@x.test" }, generic), generic);
  assert.equal(emailDbMessage(null, generic), generic);
});

test("every send error code the provider can return has words", () => {
  for (const code of ["timeout", "network_error", "provider_rejected", "provider_auth", "provider_rate_limited", "provider_unavailable", "provider_error", "not_configured"]) {
    assert.notEqual(sendErrorText(code), "", code);
  }
  assert.equal(sendErrorText("something_new"), sendErrorText("provider_error"));
  assert.match(sendErrorText("timeout"), /may or may not have been delivered/);
});
