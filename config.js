require('dotenv').config();

module.exports = {
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID
    },
    parser: {
        checkInterval: 100, // 0.1 секунда
        maxProfiles: parseInt(process.env.MAX_PROFILES) || 50,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    },
    database: {
        postsFile: './data/posts.json',
        profilesFile: './data/profiles.json',
        statsFile: './data/stats.json'
    }
};