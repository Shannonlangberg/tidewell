import test from "node:test";
import assert from "node:assert/strict";
import { abnProblem, formatAbn, isValidAbn, stripAbn } from "./abn.ts";

test("a known valid ABN passes, with or without spaces", () => {
  assert.equal(isValidAbn("51824753556"), true);
  assert.equal(isValidAbn("51 824 753 556"), true);
  assert.equal(stripAbn("51 824 753 556"), "51824753556");
  assert.equal(abnProblem("51 824 753 556"), null);
});

test("changing any one digit breaks the checksum", () => {
  const good = "51824753556";
  for (let i = 0; i < good.length; i++) {
    const digit = Number(good[i]);
    const bad = good.slice(0, i) + String((digit + 1) % 10) + good.slice(i + 1);
    if (bad[0] === "0") continue;
    assert.equal(isValidAbn(bad), false, bad);
    assert.match(abnProblem(bad) ?? "", /doesn't pass the ABN check/);
  }
});

test("plain-language problems", () => {
  assert.equal(abnProblem(""), null);
  assert.equal(abnProblem(null), null);
  assert.match(abnProblem("5182475355") ?? "", /11 digits, and this has 10/);
  assert.match(abnProblem("51-824-753-556") ?? "", /only numbers/);
  assert.match(abnProblem("01824753556") ?? "", /can't start with 0/);
});

test("formatAbn groups 11 digits and leaves anything else alone", () => {
  assert.equal(formatAbn("51824753556"), "51 824 753 556");
  assert.equal(formatAbn("123"), "123");
  assert.equal(formatAbn(null), "");
});
