const { getSetting, setSetting } = require("./settingsManager");

const MIMIC_TARGET_USER_ID = "451459488562806784";

const MAX_CHANNEL_FETCH = 500;
const MIN_SAMPLES_REQUIRED = 20;
const MAX_SAMPLES_FOR_ANALYSIS = 300;
const NUM_INLINE_SAMPLES = 8;

async function getStyleProfile(guildId) {
  return (await getSetting(guildId, "ai.styleProfile")) || null;
}

async function getStyleSamples(guildId) {
  return (await getSetting(guildId, "ai.styleSamples")) || null;
}

async function getStyleProfileUpdatedAt(guildId) {
  return (await getSetting(guildId, "ai.styleProfileUpdatedAt")) || null;
}

function pickInlineSamples(messages) {
  // Prefer messages of useful length (not one-word reactions, not huge walls)
  const candidates = messages.filter((m) => m.length >= 10 && m.length <= 200);
  const pool = candidates.length >= NUM_INLINE_SAMPLES ? candidates : messages;
  if (pool.length <= NUM_INLINE_SAMPLES) return [...pool];

  // Evenly distribute picks across the pool so we capture varied contexts
  const picks = [];
  const step = pool.length / NUM_INLINE_SAMPLES;
  for (let i = 0; i < NUM_INLINE_SAMPLES; i++) {
    picks.push(pool[Math.floor(i * step)]);
  }
  return picks;
}

async function fetchTargetUserMessages(channel, maxCollect) {
  const collected = [];
  let before;
  let fetched = 0;

  while (fetched < MAX_CHANNEL_FETCH && collected.length < maxCollect) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      if (msg.author.id !== MIMIC_TARGET_USER_ID) continue;
      const text = msg.content?.trim();
      if (!text) continue;
      if (text.startsWith("!") || text.startsWith("/")) continue;
      collected.push(text);
      if (collected.length >= maxCollect) break;
    }

    fetched += batch.size;
    before = batch.last()?.id;
    if (!before) break;
  }

  return collected;
}

async function generateStyleProfile(guild, channel, openai) {
  const samples = await fetchTargetUserMessages(
    channel,
    MAX_SAMPLES_FOR_ANALYSIS
  );

  if (samples.length < MIN_SAMPLES_REQUIRED) {
    throw new Error(
      `Only found ${samples.length} messages from the target user in this channel. Need at least ${MIN_SAMPLES_REQUIRED}. Try a busier channel.`
    );
  }

  const joinedSamples = samples.map((s) => `- ${s}`).join("\n");

  const analysisPrompt = `You will extract the speaking style of ONE specific Discord user from their raw messages, so another LLM can imitate them convincingly. The other LLM defaults to a generic "helpful assistant" voice, so your guide must be specific and aggressive enough to override that.

Rules for your output:
- NO meta-commentary. Do NOT start with "Based on the samples..." or "This user...". Just describe the voice directly in imperative form ("Talk like this:" style).
- Be BLUNT and SPECIFIC. Quote verbatim phrases they actually use — no paraphrasing.
- If they never use something, say "never uses X" — that's as important as what they do use.
- Cover: capitalization habits (lowercase? sentence case? ALL CAPS bursts?), punctuation (none? only ?? or !! for emphasis? commas?), sentence length (one-word? fragments? full sentences?), slang / catchphrases / recurring openers or closers (list 5-8 exact quoted examples), typos and intentional misspellings they repeat, emoji use (which specific ones, how often, or "never"), profanity level, tone (dry, hyped, sarcastic, deadpan, chaotic, etc.), and any other distinctive tic (e.g., always says "bruh" at end, uses "lol" without caps, never finishes sentences).
- DO NOT sanitize. If they curse, mention it. If they're mean/blunt, say so.
- Length: 150-200 words. Dense, concrete, no filler.

SAMPLES (most recent first, one per line):
${joinedSamples}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: analysisPrompt }],
    max_tokens: 500,
    temperature: 0.3,
  });

  const profile = completion.choices[0].message.content.trim();
  const inlineSamples = pickInlineSamples(samples);
  const now = Date.now();

  await setSetting(guild.id, "ai.styleProfile", profile);
  await setSetting(guild.id, "ai.styleSamples", inlineSamples);
  await setSetting(guild.id, "ai.styleProfileUpdatedAt", now);

  return {
    profile,
    sampleCount: samples.length,
    inlineSampleCount: inlineSamples.length,
    updatedAt: now,
  };
}

module.exports = {
  MIMIC_TARGET_USER_ID,
  getStyleProfile,
  getStyleSamples,
  getStyleProfileUpdatedAt,
  generateStyleProfile,
};
