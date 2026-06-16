const { test } = require("node:test");
const assert = require("node:assert");

// Force free mode ON for this test process before requiring the module.
process.env.FREE_VERSION = "true";
const fv = require("../config/freeVersion");

test("FREE_VERSION is on when env is 'true'", () => {
  assert.strictEqual(fv.FREE_VERSION, true);
});

test("isHandlerEnabled allows allow-listed handlers", () => {
  assert.strictEqual(fv.isHandlerEnabled("wordle"), true);
  assert.strictEqual(fv.isHandlerEnabled("verification"), true);
  assert.strictEqual(fv.isHandlerEnabled("logging"), true);
  assert.strictEqual(fv.isHandlerEnabled("moderation"), true);
});

test("isHandlerEnabled blocks non-allow-listed handlers when free", () => {
  assert.strictEqual(fv.isHandlerEnabled("blackjack"), false);
  assert.strictEqual(fv.isHandlerEnabled("mafia"), false);
  assert.strictEqual(fv.isHandlerEnabled("trivia"), false);
  assert.strictEqual(fv.isHandlerEnabled("eggbuck"), false);
});

test("isSlashCommandEnabled honors the slash allow-list when free", () => {
  assert.strictEqual(fv.isSlashCommandEnabled("debug"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("setup"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("help"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("verification-setup"), true);
  assert.strictEqual(fv.isSlashCommandEnabled("balance"), false);
  assert.strictEqual(fv.isSlashCommandEnabled("blackjack"), false);
});
