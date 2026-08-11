const { test } = require("node:test");
const assert = require("node:assert");

const { shouldNudge, hasBugKeyword, countWords } = require("../utils/mcNudgeMatch");

test("countWords counts whitespace-separated words", () => {
  assert.strictEqual(countWords("one two three"), 3);
  assert.strictEqual(countWords("  padded   out  "), 2);
  assert.strictEqual(countWords(""), 0);
});

test("hasBugKeyword matches strong keywords alone", () => {
  for (const text of [
    "there is a BUG here",
    "the texture glitches",
    "my game crashed",
    "throws an error",
    "the recipe fails",
    "it doesn't work",
    "it doesnt work",
    "does not work at all",
    "the world won't load",
    "game crashes when I load the world",
    "black screen on launch",
    "infinite loading screen",
    "it kicked me out of the server",
    "nothing happens when I click play",
  ]) {
    assert.strictEqual(hasBugKeyword(text), true, `expected a match for: ${text}`);
  }
});

test("hasBugKeyword matches strong keywords with curly apostrophes", () => {
  const curlyDoesnt = "it doesn" + String.fromCharCode(0x2019) + "t work";
  const curlyWont = "it won" + String.fromCharCode(0x2019) + "t load";
  assert.strictEqual(hasBugKeyword(curlyDoesnt), true);
  assert.strictEqual(hasBugKeyword(curlyWont), true);
});

test("hasBugKeyword matches loose keywords only with a game noun", () => {
  for (const text of [
    "having an issue with the mod",
    "big problem in the server",
    "my world is broken after the update",
    "the mod is not working",
    "I'm stuck on the loading screen",
    "isn't it supposed to work on the client",
  ]) {
    assert.strictEqual(hasBugKeyword(text), true, `expected a match for: ${text}`);
  }
});

test("hasBugKeyword does NOT match loose keywords without a game noun", () => {
  for (const text of [
    "having an issue",
    "big problem",
    "it's broken",
    "this is not working",
    "isn't it supposed to",
  ]) {
    assert.strictEqual(hasBugKeyword(text), false, `unexpected match for: ${text}`);
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

test("must NOT fire (flat list false positives)", () => {
  for (const text of [
    "that boss is broken op",
    "I got stuck in a ravine lol, digging my way out",
    "is the nether roof supposed to look like this?",
    "this puzzle map has a cool problem to solve",
    "not working on anything today just chilling",
  ]) {
    assert.strictEqual(shouldNudge(text), false, `should NOT fire for: ${text}`);
  }
});

test("must fire (strong patterns or loose with game noun)", () => {
  for (const text of [
    "the modpack is not loading",
    "black screen on launch",
    "infinite loading screen",
    "it kicked me out of the server",
    "nothing happens when I click play",
    "the server wont connect",
    "game crashs when I load the world",
    "my world is broken after the update",
    "the mod is not working",
    "I'm stuck on the loading screen",
    "it doesn't work",
    "there is a BUG here",
  ]) {
    assert.strictEqual(shouldNudge(text), true, `should fire for: ${text}`);
  }
});

test("keyword mode fires on a strong keyword", () => {
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
