const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  event: {
    type: String,
    required: true,
    index: true,
  },
  command: {
    type: String,
    index: true,
  },
  guildId: {
    type: String,
    index: true,
  },
  userId: String,
  metadata: mongoose.Schema.Types.Mixed,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Compound indexes for common queries
analyticsSchema.index({ event: 1, timestamp: -1 });
analyticsSchema.index({ command: 1, timestamp: -1 });
analyticsSchema.index({ guildId: 1, event: 1, timestamp: -1 });

module.exports = mongoose.model('Analytics', analyticsSchema);
