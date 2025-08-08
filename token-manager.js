// token-manager.js - Управление пулом токенов для мультиаккаунт парсинга
const logger = require('./logger');
const fs = require('fs-extra');
const path = require('path');

class TokenManager {
    constructor() {
        this.tokens = [];
        this.currentIndex = 0;
        this.tokenStats = new Map(); // token -> {requests: 0, errors: 0, lastUsed: Date}
        this.cooldowns = new Map(); // token -> cooldownUntil
        this.tokensFile = './data/tokens.json';
    }

    // Инициализация TokenManager
    async init() {
        try {
            await this.loadTokens();
            logger.info(`🎫 TokenManager initialized with ${this.tokens.length} tokens`);
            return true;
        } catch (error) {
            logger.error(`❌ TokenManager initialization failed: ${error.message}`);
            return false;
        }
    }

    // Загрузка токенов из файла
    async loadTokens() {
        try {
            if (await fs.pathExists(this.tokensFile)) {
                const data = await fs.readJson(this.tokensFile);
                this.tokens = data.tokens || [];
                this.tokenStats = new Map(data.stats || []);
                
                logger.info(`📂 Loaded ${this.tokens.length} tokens from file`);
            } else {
                // Создаем файл с одним токеном который работает
                this.tokens = ['jfRAO-HNDPIDuhZim4P4HJP9LPr3O6RQ6gRJ_9t5WKA'];
                await this.saveTokens();
                logger.info(`📂 Created tokens file with 1 default token`);
            }
        } catch (error) {
            logger.error(`❌ Error loading tokens: ${error.message}`);
            this.tokens = ['jfRAO-HNDPIDuhZim4P4HJP9LPr3O6RQ6gRJ_9t5WKA'];
        }
    }

    // Сохранение токенов в файл
    async saveTokens() {
        try {
            await fs.ensureDir('./data');
            await fs.writeJson(this.tokensFile, {
                tokens: this.tokens,
                stats: Array.from(this.tokenStats.entries()),
                savedAt: new Date().toISOString()
            });
        } catch (error) {
            logger.error(`❌ Error saving tokens: ${error.message}`);
        }
    }

    

    // Получить следующий доступный токен
    getNextToken() {
        if (this.tokens.length === 0) {
            logger.error('❌ No tokens available');
            return null;
        }

        // Ищем токен не в cooldown
        const now = Date.now();
        let attempts = 0;
        
        while (attempts < this.tokens.length) {
            const token = this.tokens[this.currentIndex];
            const cooldownUntil = this.cooldowns.get(token) || 0;
            
            if (now >= cooldownUntil) {
                // Токен доступен
                this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
                
                // Обновляем статистику
                const stats = this.tokenStats.get(token) || { requests: 0, errors: 0, lastUsed: 0 };
                stats.requests++;
                stats.lastUsed = now;
                this.tokenStats.set(token, stats);
                
                logger.info(`🎫 Using token ${this.currentIndex}: ${token.substring(0, 20)}... (used ${stats.requests} times)`);
                return token;
            }
            
            // Токен в cooldown, пробуем следующий
            this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
            attempts++;
        }
        
        
        // Все токены в cooldown
        logger.warn('⚠️ All tokens in cooldown, using first available');
        const token = this.tokens[0];
        return token;
    }

    // Отметить ошибку токена (429, блокировка и т.д.)
    markTokenError(token, errorType = 'unknown') {
        const stats = this.tokenStats.get(token) || { requests: 0, errors: 0, lastUsed: 0 };
        stats.errors++;
        this.tokenStats.set(token, stats);
        
        // Устанавливаем cooldown в зависимости от типа ошибки
        const now = Date.now();
        let cooldownTime = 0;
        
        switch (errorType) {
            case 'rate_limit': // 429 Too Many Requests
                cooldownTime = 10 * 60 * 1000; // 10 минут
                break;
            case 'unauthorized': // 401/403
                cooldownTime = 60 * 60 * 1000; // 1 час
                break;
            default:
                cooldownTime = 5 * 60 * 1000; // 5 минут
        }
        
        this.cooldowns.set(token, now + cooldownTime);
        logger.warn(`❌ Token error (${errorType}): ${token.substring(0, 20)}... cooldown for ${cooldownTime/1000/60} minutes`);
    }

    // Добавить новый токен
    async addToken(newToken) {
        if (!this.tokens.includes(newToken)) {
            this.tokens.push(newToken);
            await this.saveTokens();
            logger.info(`✅ Added new token: ${newToken.substring(0, 20)}... (total: ${this.tokens.length})`);
            return true;
        } else {
            logger.warn(`⚠️ Token already exists: ${newToken.substring(0, 20)}...`);
            return false;
        }
    }

    // Удалить токен по индексу
async removeToken(index) {
    if (index >= 0 && index < this.tokens.length) {
        const removedToken = this.tokens.splice(index, 1)[0];
        this.tokenStats.delete(removedToken);
        this.cooldowns.delete(removedToken);
        await this.saveTokens();
        logger.info(`❌ Removed token: ${removedToken.substring(0, 20)}... (remaining: ${this.tokens.length})`);
        return true;
    }
    return false;
}

    // Получить статистику токенов
    getStats() {
        const now = Date.now();
        const stats = {
            totalTokens: this.tokens.length,
            availableTokens: 0,
            cooldownTokens: 0,
            tokens: []
        };

        this.tokens.forEach((token, index) => {
            const tokenStats = this.tokenStats.get(token) || { requests: 0, errors: 0, lastUsed: 0 };
            const cooldownUntil = this.cooldowns.get(token) || 0;
            const inCooldown = now < cooldownUntil;
            
            if (inCooldown) {
                stats.cooldownTokens++;
            } else {
                stats.availableTokens++;
            }
            
            stats.tokens.push({
                index: index,
                token: token.substring(0, 20) + '...',
                requests: tokenStats.requests,
                errors: tokenStats.errors,
                lastUsed: tokenStats.lastUsed,
                cooldownUntil: cooldownUntil,
                available: !inCooldown
            });
        });

        return stats;
    }
}

module.exports = TokenManager;