// ===============================================
// VALORANT TEAM BALANCER
// ===============================================
// Handles team balancing algorithms and skill score calculations

/**
 * Calculates an enhanced skill score for a player
 * @param {number} currentTier - Current rank tier (0-27)
 * @param {number} peakTier - Peak rank tier (0-27)
 * @param {number} winRate - Win rate percentage (0-100)
 * @param {number} currentRR - Current ranked rating (0-100)
 * @param {number} avgKDA - Average KDA ratio
 * @param {number} avgACS - Average combat score
 * @returns {number} - Calculated skill score
 */
function calculateEnhancedSkillScore(currentTier, peakTier, winRate, currentRR, avgKDA, avgACS) {
    // Enhanced skill score formula with KDA and ACS integration
    // Current tier: 30% weight (most important)
    // KDA: 20% weight (individual skill)
    // ACS: 15% weight (combat impact per round)
    // Win rate: 15% weight
    // Peak tier: 15% weight
    // Current RR: 5% weight

    const currentScore = currentTier * 0.30;

    // KDA score: normalize to similar scale as ranks (0-27)
    // Good KDA is around 1.0-1.5, excellent is 2.0+
    const kdaScore = Math.min(avgKDA * 8, 27) * 0.20; // Cap at 27 equivalent points

    // ACS score: normalize to 0-27 scale (300+ ACS = max score)
    const acsScore = Math.min((avgACS || 0) / 300, 1) * 27 * 0.15;

    const winRateScore = (winRate / 100) * 8 * 0.15; // Normalize win rate to similar scale
    const peakScore = peakTier * 0.15;
    const rrScore = (currentRR / 100) * 0.05; // RR contributes least

    const totalScore = currentScore + kdaScore + acsScore + winRateScore + peakScore + rrScore;

    console.log(`[Team Balancer] Skill calculation: Current(${currentTier}*0.30=${currentScore.toFixed(2)}) + KDA(${avgKDA.toFixed(2)}*8*0.20=${kdaScore.toFixed(2)}) + ACS(${(avgACS || 0).toFixed(0)}/300*0.15=${acsScore.toFixed(2)}) + WR(${winRate.toFixed(1)}%*0.15=${winRateScore.toFixed(2)}) + Peak(${peakTier}*0.15=${peakScore.toFixed(2)}) + RR(${currentRR}*0.05=${rrScore.toFixed(2)}) = ${totalScore.toFixed(2)}`);

    return totalScore;
}

/**
 * Creates balanced teams from a list of players using snake draft algorithm
 * @param {Array} players - Array of player objects with skillScore, avgKDA, winRate properties
 * @returns {Array} - Array of team objects
 */
function createBalancedTeams(players) {
    // Sort players by skill score (highest to lowest)
    players.sort((a, b) => b.skillScore - a.skillScore);

    // Determine number of teams (try for teams of 5, minimum 2 teams)
    const numPlayers = players.length;
    let numTeams = Math.max(2, Math.floor(numPlayers / 5));

    // If we have exactly 10 players, make 2 teams of 5
    if (numPlayers === 10) {
        numTeams = 2;
    }
    // If we have 6-9 players, make 2 teams
    else if (numPlayers >= 6 && numPlayers <= 9) {
        numTeams = 2;
    }
    // If we have 11-15 players, make 3 teams
    else if (numPlayers >= 11 && numPlayers <= 15) {
        numTeams = 3;
    }

    // Initialize teams
    const teams = Array.from({ length: numTeams }, () => ({
        players: [],
        totalSkill: 0,
        avgSkill: 0,
        totalKDA: 0,
        avgKDA: 0,
        avgWinRate: 0
    }));

    // Use snake draft algorithm for better balance
    let teamIndex = 0;
    let direction = 1;

    for (let i = 0; i < players.length; i++) {
        teams[teamIndex].players.push(players[i]);
        teams[teamIndex].totalSkill += players[i].skillScore;
        teams[teamIndex].totalKDA += players[i].avgKDA;

        // Calculate team averages
        const teamSize = teams[teamIndex].players.length;
        teams[teamIndex].avgSkill = teams[teamIndex].totalSkill / teamSize;
        teams[teamIndex].avgKDA = teams[teamIndex].totalKDA / teamSize;
        teams[teamIndex].avgWinRate = teams[teamIndex].players.reduce((sum, p) => sum + p.winRate, 0) / teamSize;

        // Snake draft: 0,1,2,2,1,0,0,1,2,2,1,0...
        if (direction === 1) {
            teamIndex++;
            if (teamIndex >= numTeams) {
                teamIndex = numTeams - 1;
                direction = -1;
            }
        } else {
            teamIndex--;
            if (teamIndex < 0) {
                teamIndex = 0;
                direction = 1;
            }
        }
    }

    console.log(`[Team Balancer] Created ${numTeams} balanced teams from ${numPlayers} players`);
    teams.forEach((team, index) => {
        console.log(`  Team ${index + 1}: ${team.players.length} players, Avg Skill: ${team.avgSkill.toFixed(2)}, Avg KDA: ${team.avgKDA.toFixed(2)}, Avg WR: ${team.avgWinRate.toFixed(1)}%`);
    });

    return teams;
}

/**
 * Calculates team balance quality (lower is better)
 * @param {Array} teams - Array of team objects
 * @returns {number} - Balance score (standard deviation of team skills)
 */
function calculateTeamBalance(teams) {
    if (teams.length < 2) return 0;

    // Calculate mean skill
    const meanSkill = teams.reduce((sum, team) => sum + team.avgSkill, 0) / teams.length;

    // Calculate standard deviation
    const variance = teams.reduce((sum, team) => {
        const diff = team.avgSkill - meanSkill;
        return sum + (diff * diff);
    }, 0) / teams.length;

    return Math.sqrt(variance);
}

/**
 * Gets the team with the lowest total skill (for greedy algorithm)
 * @param {Array} teams - Array of team objects
 * @returns {Object} - The team with lowest skill
 */
function getLowestSkillTeam(teams) {
    return teams.reduce((lowest, team) =>
        team.totalSkill < lowest.totalSkill ? team : lowest
    );
}

/**
 * Distributes players to teams greedily (always assign to lowest skill team)
 * @param {Array} players - Array of player objects with skillScore
 * @param {number} numTeams - Number of teams to create
 * @returns {Array} - Array of team objects
 */
function createGreedyTeams(players, numTeams = 2) {
    // Sort players by skill score (highest to lowest)
    players.sort((a, b) => b.skillScore - a.skillScore);

    // Initialize teams
    const teams = Array.from({ length: numTeams }, () => ({
        players: [],
        totalSkill: 0,
        avgSkill: 0,
        totalKDA: 0,
        avgKDA: 0,
        avgWinRate: 0
    }));

    // Assign each player to the team with lowest total skill
    for (const player of players) {
        const lowestTeam = getLowestSkillTeam(teams);
        lowestTeam.players.push(player);
        lowestTeam.totalSkill += player.skillScore;
        lowestTeam.totalKDA += player.avgKDA;

        // Update team averages
        const teamSize = lowestTeam.players.length;
        lowestTeam.avgSkill = lowestTeam.totalSkill / teamSize;
        lowestTeam.avgKDA = lowestTeam.totalKDA / teamSize;
        lowestTeam.avgWinRate = lowestTeam.players.reduce((sum, p) => sum + p.winRate, 0) / teamSize;
    }

    console.log(`[Team Balancer] Created ${numTeams} teams using greedy algorithm from ${players.length} players`);
    teams.forEach((team, index) => {
        console.log(`  Team ${index + 1}: ${team.players.length} players, Avg Skill: ${team.avgSkill.toFixed(2)}`);
    });

    return teams;
}

module.exports = {
    calculateEnhancedSkillScore,
    createBalancedTeams,
    calculateTeamBalance,
    getLowestSkillTeam,
    createGreedyTeams
};
