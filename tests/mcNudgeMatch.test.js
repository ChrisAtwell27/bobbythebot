const { test } = require("node:test");
const assert = require("node:assert");

const { shouldNudge, hasBugKeyword, countWords } = require("../utils/mcNudgeMatch");

test("countWords counts whitespace-separated words", () => {
  assert.strictEqual(countWords("one two three"), 3);
  assert.strictEqual(countWords("  padded   out  "), 2);
  assert.strictEqual(countWords(""), 0);
});

test("hasBugKeyword matches the core keywords in any case", () => {
  for (const text of [
    "there is a BUG here",
    "having an issue",
    "big problem",
    "the texture glitches",
    "my game crashed",
    "it's broken",
    "throws an error",
    "the recipe fails",
    "it doesn't work",
    "it doesnt work",
    "does not work at all",
    "this is not working",
    "the world won't load",
    "isn't it supposed to smelt",
    "I'm stuck on the loading screen",
  ]) {
    assert.strictEqual(hasBugKeyword(text), true, `expected a match for: ${text}`);
  }
});

test("hasBugKeyword does not match ordinary chat", () => {
  for (const text of [
    "hey everyone how is it going today",
    "just joined the server, love the mod",
    "what is the best way to farm diamonds",
    "gg that was a fun round",
  ]) {
    assert.strictEqual(hasBugKeyword(text), false, `unexpected match for: ${text}`);
  }
});

test("hasBugKeyword does not match keywords buried inside other words", () => {
  assert.strictEqual(hasBugKeyword("debugging is fun"), false);
  assert.strictEqual(hasBugKeyword("network is a tissue"), false);
});

test("keyword mode fires on a short report", () => {
  assert.strictEqual(shouldNudge("game crashes on load"), true);
});

test("keyword mode ignores a long message with no keyword", () => {
  assert.strictEqual(
    shouldNudge("hey guys I just joined this server today and I am having fun"),
    false
  );
});

test("keyword mode ignores empty or whitespace messages", () => {
  assert.strictEqual(shouldNudge(""), false);
  assert.strictEqual(shouldNudge("   "), false);
  assert.strictEqual(shouldNudge(null), false);
});

test("keyword-or-length mode also fires on any message over six words", () => {
  assert.strictEqual(
    shouldNudge("hey guys I just joined this server today", "keyword-or-length"),
    true
  );
});

test("keyword-or-length mode leaves messages of six words or fewer alone", () => {
  assert.strictEqual(shouldNudge("hey guys how is everyone doing", "keyword-or-length"), false);
});

test("an unknown mode falls back to keyword behaviour", () => {
  assert.strictEqual(shouldNudge("hey guys I just joined this server today", "nonsense"), false);
  assert.strictEqual(shouldNudge("it crashed", "nonsense"), true);
});

test("hasBugKeyword matches doesn't work with curly apostrophe", () => {
  const curlyForm = "it doesn" + String.fromCharCode(0x2019) + "t work";
  assert.strictEqual(hasBugKeyword(curlyForm), true);
});

test("hasBugKeyword matches won't load with curly apostrophe", () => {
  const curlyForm = "it won" + String.fromCharCode(0x2019) + "t load";
  assert.strictEqual(hasBugKeyword(curlyForm), true);
});
