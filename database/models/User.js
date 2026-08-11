const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    // User memories for Bobby's conversation context
    memory: {
        type: String,
        default: ''
    },
    // Personality score (1-10, default 5)
    personalityScore: {
        type: Number,
        default: 5,
        min: 1,
        max: 10
    },
    // Economy data
    balance: {
        type: Number,
        default: 0
    },
    // Activity tracking
    messageCount: {
        type: Number,
        default: 0
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    dailyMessageCount: {
        type: Number,
        default: 0
    },
    lastDailyReset: {
        type: Date,
        default: Date.now
    },
    // One-time nudge pointing Minecraft players at the bug forum
    mcForumNudgedAt: {
        type: Date,
        default: null
    },
    // Virtual pet data
    pet: {
        id: String,
        name: String,
        petType: String,  // Renamed from 'type' to avoid Mongoose conflict
        emoji: String,
        hunger: {
            type: Number,
            default: 100
        },
        happiness: {
            type: Number,
            default: 100
        },
        health: {
            type: Number,
            default: 100
        },
        energy: {
            type: Number,
            default: 100
        },
        cleanliness: {
            type: Number,
            default: 100
        },
        level: {
            type: Number,
            default: 1
        },
        xp: {
            type: Number,
            default: 0
        },
        experience: {
            type: Number,
            default: 0
        },
        age: {
            type: Number,
            default: 0
        },
        created: {
            type: Number,
            default: Date.now
        },
        lastStatUpdate: {
            type: Number,
            default: Date.now
        },
        lastFed: Date,
        lastPlayed: Date,
        lastTrained: Date,
        personality: String,
        isSleeping: {
            type: Boolean,
            default: false
        },
        sleepStartTime: Number,
        stats: {
            type: Map,
            of: Number,
            default: new Map()
        },
        inventory: {
            type: Map,
            of: Number,
            default: new Map()
        },
        adoptedAt: Date,
        achievements: {
            type: [String],
            default: []
        }
    },
    // Birthday (format: MM-DD-YYYY)
    birthday: {
        month: Number,    // 1-12
        day: Number,      // 1-31
        year: Number      // Birth year
    },
    lastBirthdayWish: {
        type: Number,     // Year of last birthday wish
        default: null
    },
    // Valorant stats
    valorant: {
        puuid: String,
        name: String,
        tag: String,
        region: String,
        registeredAt: Date,
        lastUpdated: Date,
        preferredAgents: {
            type: [String],
            default: []
        },
        blockedUsers: {
            type: [String],
            default: []
        }
    },
    // Gladiator arena stats
    arenaStats: {
        wins: {
            type: Number,
            default: 0
        },
        losses: {
            type: Number,
            default: 0
        },
        kills: {
            type: Number,
            default: 0
        },
        deaths: {
            type: Number,
            default: 0
        },
        favoriteClass: String
    },
    // Mafia game stats
    mafiaStats: {
        gamesPlayed: {
            type: Number,
            default: 0
        },
        gamesWon: {
            type: Number,
            default: 0
        },
        rolesPlayed: {
            type: [String],
            default: []
        }
    },
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for faster queries
userSchema.index({ balance: -1 }); // For baltop
userSchema.index({ dailyMessageCount: -1 }); // For activetop
userSchema.index({ 'pet.level': -1 }); // For pet leaderboard

// Delete existing model if it exists (prevents caching issues)
if (mongoose.models.User) {
    delete mongoose.models.User;
}

const User = mongoose.model('User', userSchema);

module.exports = User;
