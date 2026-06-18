const { test } = require("node:test");
const assert = require("node:assert");

const fv = require("../config/freeVersion");

const FULL_GUILD = "701308904877064193"; // main server — gets everything
const OTHER_GUILD = "999999999999999999"; // any other server — free tier

test("FULL_SERVER_IDS includes the main server", () => {
  assert.ok(fv.FULL_SERVER_IDS.has(FULL_GUILD));
});

test("isFullServer is true only for allow-listed guilds", () => {
  assert.strictEqual(fv.isFullServer(FULL_GUILD), true);
  assert.strictEqual(fv.isFullServer(OTHER_GUILD), false);
  assert.strictEqual(fv.isFullServer(null), false);
  assert.strictEqual(fv.isFullServer(undefined), false);
});

test("full servers get EVERY feature", () => {
  assert.strictEqual(fv.isFeatureAllowedInGuild("ask", FULL_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("blackjack", FULL_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("mafia", FULL_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("wordle", FULL_GUILD), true);
});

test("free servers get only security + wordle + infra features", () => {
  // allowed-everywhere features
  assert.strictEqual(fv.isFeatureAllowedInGuild("wordle", OTHER_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("logging", OTHER_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("moderation", OTHER_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("verification", OTHER_GUILD), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("help", OTHER_GUILD), true);
  // blocked-on-free features
  assert.strictEqual(fv.isFeatureAllowedInGuild("ask", OTHER_GUILD), false);
  assert.strictEqual(fv.isFeatureAllowedInGuild("blackjack", OTHER_GUILD), false);
  assert.strictEqual(fv.isFeatureAllowedInGuild("mafia", OTHER_GUILD), false);
  assert.strictEqual(fv.isFeatureAllowedInGuild("eggbuck", OTHER_GUILD), false);
});

test("no guild id (DMs) is treated as free (security/wordle only)", () => {
  assert.strictEqual(fv.isFeatureAllowedInGuild("wordle", null), true);
  assert.strictEqual(fv.isFeatureAllowedInGuild("blackjack", null), false);
});

test("an undefined/unknown feature key is treated as a non-free extra", () => {
  // Unknown keys are NOT in the free allow-list, so blocked on free guilds...
  assert.strictEqual(fv.isFeatureAllowedInGuild("somethingNew", OTHER_GUILD), false);
  // ...but still allowed on full servers.
  assert.strictEqual(fv.isFeatureAllowedInGuild("somethingNew", FULL_GUILD), true);
});

test("FREE_FEATURES contains the security + wordle + infra keys", () => {
  for (const key of ["verification", "moderation", "logging", "wordle", "help", "guildJoin"]) {
    assert.ok(fv.FREE_FEATURES.has(key), `FREE_FEATURES missing ${key}`);
  }
});
