const TruthSocialParser = require('./stealth-parser');
const TelegramNotifier = require('./telegram');
const Database = require('./database');
const config = require('./config');
const logger = require('./logger');

class ParserApp {
    constructor() {
        this.parser = new TruthSocialParser();
        this.telegram = new TelegramNotifier();
        this.database = new Database();
        this.isRunning = false;
        this.profiles = [];
    }

    async start() {
        try {
            logger.info('Starting Truth Social Parser...');
            
            await this.parser.init();
            this.profiles = await this.database.getProfiles();
            
            if (this.profiles.length === 0) {
                logger.warn('No profiles to monitor. Add profiles to data/profiles.json');
                return;
            }

            // Создаём страницы для всех профилей
            // Запускаем браузер фарм для обхода защиты
            logger.info(`Starting browser farm for ${this.profiles.length} profiles`);

            this.isRunning = true;
            await this.telegram.sendMessage('🚀 <b>Парсер запущен</b>');
            
            this.startMonitoring();
            
        } catch (error) {
            logger.error('Start error:', error);
            await this.telegram.sendError(error.message);
        }
    }

    async startMonitoring() {
        while (this.isRunning) {
            try {
                await this.checkAllProfiles();
                await this.sleep(config.parser.checkInterval);
            } catch (error) {
                logger.error('Monitoring error:', error);
                await this.telegram.sendError(error.message);
                await this.database.updateStats('errors');
            }
        }
    }

    async checkAllProfiles() {
        logger.info(`Checking posts for ${this.profiles.length} profiles...`);
        for (const profile of this.profiles) {
            try {
                const post = await this.parser.parseLatestPost(profile.username);
                
                if (post && this.isNewPost(profile.username, post.id)) {
                    const fullPost = {
                        ...post,
                        username: profile.username,
                        url: `https://truthsocial.com/@${profile.username}`,
                        keywords: profile.keywords || []
                    };

                    if (this.shouldNotify(fullPost, profile.keywords)) {
                        await this.database.savePost(fullPost);
                        await this.telegram.sendPost(fullPost);
                        await this.database.updateStats('totalPosts');
                        
                        this.parser.lastPostIds.set(profile.username, post.id);
                        logger.info(`New post from ${profile.username}: ${post.content.substring(0, 50)}...`);
                    }
                }
            } catch (error) {
                logger.error(`Check profile error ${profile.username}:`, error);
            }
        }
    }

    isNewPost(username, postId) {
        const lastId = this.parser.lastPostIds.get(username);
        return lastId !== postId;
    }

    shouldNotify(post, keywords) {
        if (!keywords || keywords.length === 0) return true;
        
        const content = post.content.toLowerCase();
        return keywords.some(keyword => content.includes(keyword.toLowerCase()));
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async stop() {
        this.isRunning = false;
        await this.parser.close();
        logger.info('Parser stopped');
    }
}

// Запуск приложения
const app = new ParserApp();

process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await app.stop();
    process.exit(0);
});

app.start().catch(error => {
    logger.error('App start error:', error);
    process.exit(1);
});