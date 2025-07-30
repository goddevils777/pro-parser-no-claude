const fs = require('fs-extra');
const config = require('./config');
const logger = require('./logger');

class Database {
    constructor() {
        this.ensureDataFiles();
    }

    async ensureDataFiles() {
        try {
            await fs.ensureFile(config.database.postsFile);
            await fs.ensureFile(config.database.profilesFile);
            await fs.ensureFile(config.database.statsFile);
            
            // Инициализируем пустые файлы если они новые
            if (!(await this.fileExists(config.database.postsFile))) {
                await fs.writeJson(config.database.postsFile, []);
            }
            if (!(await this.fileExists(config.database.profilesFile))) {
                await fs.writeJson(config.database.profilesFile, []);
            }
            if (!(await this.fileExists(config.database.statsFile))) {
                await fs.writeJson(config.database.statsFile, { totalPosts: 0, errors: 0, startTime: Date.now() });
            }
        } catch (error) {
            logger.error('Database init error:', error);
        }
    }

    async fileExists(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return content.trim().length > 0;
        } catch {
            return false;
        }
    }

    async savePost(post) {
        try {
            const posts = await fs.readJson(config.database.postsFile);
            posts.push(post);
            await fs.writeJson(config.database.postsFile, posts);
            logger.info(`Post saved: ${post.id}`);
        } catch (error) {
            logger.error('Save post error:', error);
        }
    }

    async getProfiles() {
        try {
            return await fs.readJson(config.database.profilesFile);
        } catch (error) {
            logger.error('Get profiles error:', error);
            return [];
        }
    }

    async updateStats(type) {
        try {
            const stats = await fs.readJson(config.database.statsFile);
            stats[type]++;
            await fs.writeJson(config.database.statsFile, stats);
        } catch (error) {
            logger.error('Update stats error:', error);
        }
    }
}

module.exports = Database;