const { getSetting, setSetting } = require("./settingsManager");

const MIMIC_TARGET_USER_ID = "451459488562806784";

const MAX_CHANNEL_FETCH = 500;
const MIN_SAMPLES_REQUIRED = 20;
const MAX_SAMPLES_FOR_ANALYSIS = 300;

async function getStyleProfile(guildId) {
  return (await getSetting(guildId, "ai.styleProfile")) || null;
}

async function getStyleProfileUpdatedAt(guildId) {
  return (await getSetting(guildId, "ai.styleProfileUpdatedAt")) || null;
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

  const analysisPrompt = `You are analyzing Discord messages from one specific user to produce a compact style guide another AI will use to imitate how they talk.

Produce a ~150-word guide covering ONLY things that are actually observable in the samples:
- Vocabulary, slang, and recurring phrases (quote 3-5 exact examples)
- Capitalization and punctuation habits (all lowercase? no periods? caps for emphasis?)
- Typical sentence length and structure
- Emoji use: frequent, specific ones, or none
- Consistent typos or intentional misspellings
- Tone: sarcastic, blunt, enthusiastic, dry, chill, etc.
- Topics they gravitate toward

Write as a descriptive guide that will be injected directly into another model's system prompt. Be concrete with quoted examples. Do not add meta-commentary like "Based on the samples...". Just describe the style.

MESSAGE SAMPLES (most recent first):
${joinedSamples}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: analysisPrompt }],
    max_tokens: 400,
    temperature: 0.3,
  });

  const profile = completion.choices[0].message.content.trim();
  const now = Date.now();

  await setSetting(guild.id, "ai.styleProfile", profile);
  await setSetting(guild.id, "ai.styleProfileUpdatedAt", now);

  return {
    profile,
    sampleCount: samples.length,
    updatedAt: now,
  };
}

module.exports = {
  MIMIC_TARGET_USER_ID,
  getStyleProfile,
  getStyleProfileUpdatedAt,
  generateStyleProfile,
};
