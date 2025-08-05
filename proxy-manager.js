// proxy-manager-v2.js - Умный менеджер прокси с white/black листами
const fs = require('fs-extra');
const logger = require('./logger');

class ProxyManager {
    constructor() {
        this.allProxies = []; // Все прокси из файла
        this.whiteList = new Set(); // Рабочие прокси для Truth Social
        this.blackList = new Set(); // Заблокированные прокси
        this.currentIndex = 0;
        
        // Статистика
        this.stats = {
            total: 0,
            whiteListed: 0,
            blackListed: 0,
            untested: 0,
            lastUpdate: null
        };
        
        // Файлы для сохранения
        this.whiteListFile = './data/proxy-whitelist.json';
        this.blackListFile = './data/proxy-blacklist.json';
        this.statsFile = './data/proxy-stats.json';
        
        this.init();
    }

    // Инициализация
    async init() {
        try {
            await this.loadProxies();
            await this.loadWhiteList();
            await this.loadBlackList();
            await this.loadStats();
            
            logger.info(`📊 Proxy Manager initialized: ${this.stats.total} total, ${this.stats.whiteListed} white, ${this.stats.blackListed} black`);
        } catch (error) {
            logger.error(`Error initializing ProxyManager: ${error.message}`);
        }
    }

    // Загрузка всех прокси из файла
    async loadProxies() {
        try {
            const proxyFile = './port_list.txt';
            if (await fs.pathExists(proxyFile)) {
                const content = await fs.readFile(proxyFile, 'utf8');
                
                this.allProxies = content.split('\n')
                    .filter(line => line.trim())
                    .map(line => line.trim());
                
                this.stats.total = this.allProxies.length;
                logger.info(`📡 Loaded ${this.allProxies.length} proxies from file`);
            } else {
                logger.warn('⚠️ No proxy file found');
                this.allProxies = [];
            }
        } catch (error) {
            logger.error(`Error loading proxies: ${error.message}`);
        }
    }

    // Загрузка белого списка
    async loadWhiteList() {
        try {
            if (await fs.pathExists(this.whiteListFile)) {
                const whiteListData = await fs.readJson(this.whiteListFile);
                this.whiteList = new Set(whiteListData);
                this.stats.whiteListed = this.whiteList.size;
                logger.info(`✅ Loaded ${this.whiteList.size} whitelisted proxies`);
            }
        } catch (error) {
            logger.error(`Error loading whitelist: ${error.message}`);
        }
    }

    // Загрузка черного списка
    async loadBlackList() {
        try {
            if (await fs.pathExists(this.blackListFile)) {
                const blackListData = await fs.readJson(this.blackListFile);
                this.blackList = new Set(blackListData);
                this.stats.blackListed = this.blackList.size;
                logger.info(`❌ Loaded ${this.blackList.size} blacklisted proxies`);
            }
        } catch (error) {
            logger.error(`Error loading blacklist: ${error.message}`);
        }
    }

    // Загрузка статистики
    async loadStats() {
        try {
            if (await fs.pathExists(this.statsFile)) {
                const savedStats = await fs.readJson(this.statsFile);
                this.stats = { ...this.stats, ...savedStats };
            }
            
            this.updateStats();
        } catch (error) {
            logger.error(`Error loading stats: ${error.message}`);
        }
    }

    // Сохранение белого списка
    async saveWhiteList() {
        try {
            await fs.ensureDir('./data');
            await fs.writeJson(this.whiteListFile, Array.from(this.whiteList));
            logger.info(`💾 Saved whitelist: ${this.whiteList.size} proxies`);
        } catch (error) {
            logger.error(`Error saving whitelist: ${error.message}`);
        }
    }

    // Сохранение черного списка
    async saveBlackList() {
        try {
            await fs.ensureDir('./data');
            await fs.writeJson(this.blackListFile, Array.from(this.blackList));
            logger.info(`💾 Saved blacklist: ${this.blackList.size} proxies`);
        } catch (error) {
            logger.error(`Error saving blacklist: ${error.message}`);
        }
    }

    // Сохранение статистики
    async saveStats() {
        try {
            await fs.ensureDir('./data');
            await fs.writeJson(this.statsFile, this.stats);
        } catch (error) {
            logger.error(`Error saving stats: ${error.message}`);
        }
    }

    // Обновление статистики
    updateStats() {
        this.stats.whiteListed = this.whiteList.size;
        this.stats.blackListed = this.blackList.size;
        this.stats.untested = this.stats.total - this.stats.whiteListed - this.stats.blackListed;
        this.stats.lastUpdate = new Date().toISOString();
    }

    // Получить лучший доступный прокси
    getBestProxy() {
        // Приоритет 1: Белый список (проверенные рабочие)
        if (this.whiteList.size > 0) {
            const whiteProxies = Array.from(this.whiteList);
            const selectedProxy = whiteProxies[Math.floor(Math.random() * whiteProxies.length)];
            logger.info(`🟢 Using whitelisted proxy: ${selectedProxy}`);
            return selectedProxy;
        }

        // Приоритет 2: Непроверенные прокси (исключая черный список)
        const untestedProxies = this.allProxies.filter(proxy => 
            !this.whiteList.has(proxy) && !this.blackList.has(proxy)
        );

        if (untestedProxies.length > 0) {
            const selectedProxy = untestedProxies[Math.floor(Math.random() * untestedProxies.length)];
            logger.info(`🟡 Using untested proxy: ${selectedProxy}`);
            return selectedProxy;
        }

        // Приоритет 3: Случайный из всех (если все в черном списке)
        if (this.allProxies.length > 0) {
            const selectedProxy = this.allProxies[Math.floor(Math.random() * this.allProxies.length)];
            logger.warn(`🔄 Using random proxy (all tested): ${selectedProxy}`);
            return selectedProxy;
        }

        logger.error('❌ No proxies available');
        return null;
    }

    // Получить следующий прокси по порядку (для тестирования)
    getNextProxy() {
        if (this.allProxies.length === 0) return null;
        
        const proxy = this.allProxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.allProxies.length;
        
        return proxy;
    }

    // Добавить прокси в белый список (рабочий для Truth Social)
    async addToWhiteList(proxy, reason = 'working') {
        if (!proxy) return;
        
        this.whiteList.add(proxy);
        this.blackList.delete(proxy); // Убираем из черного списка если был там
        
        logger.info(`✅ Added to whitelist: ${proxy} (${reason})`);
        
        this.updateStats();
        await this.saveWhiteList();
        await this.saveStats();
    }

    // Добавить прокси в черный список (не работает с Truth Social)
    async addToBlackList(proxy, reason = 'blocked') {
        if (!proxy) return;
        
        this.blackList.add(proxy);
        this.whiteList.delete(proxy); // Убираем из белого списка если был там
        
        logger.warn(`❌ Added to blacklist: ${proxy} (${reason})`);
        
        this.updateStats();
        await this.saveBlackList();
        await this.saveStats();
    }

    // Проверить статус прокси
    getProxyStatus(proxy) {
        if (this.whiteList.has(proxy)) return 'whitelisted';
        if (this.blackList.has(proxy)) return 'blacklisted';
        return 'untested';
    }

    // Получить статистику
    getStats() {
        this.updateStats();
        return {
            ...this.stats,
            successRate: this.stats.total > 0 ? 
                Math.round((this.stats.whiteListed / this.stats.total) * 100) : 0
        };
    }

    // Очистить черный список (для переотестирования)
    async clearBlackList() {
        const count = this.blackList.size;
        this.blackList.clear();
        
        logger.info(`🗑️ Cleared blacklist: ${count} proxies moved back to untested`);
        
        this.updateStats();
        await this.saveBlackList();
        await this.saveStats();
        
        return count;
    }

    // Получить лучшие прокси для тестирования
    getProxiesForTesting(limit = 5) {
        // Сначала непроверенные
        const untested = this.allProxies.filter(proxy => 
            !this.whiteList.has(proxy) && !this.blackList.has(proxy)
        );
        
        if (untested.length >= limit) {
            return untested.slice(0, limit);
        }
        
        // Если непроверенных мало, добавляем из белого списка
        const whitelisted = Array.from(this.whiteList);
        const result = [...untested];
        
        const needed = limit - result.length;
        if (needed > 0 && whitelisted.length > 0) {
            const additional = whitelisted.slice(0, needed);
            result.push(...additional);
        }
        
        return result;
    }

    // Получить отчет о состоянии прокси
    getReport() {
        const stats = this.getStats();
        
        return {
            summary: `${stats.total} total, ${stats.whiteListed} working (${stats.successRate}%), ${stats.blackListed} blocked, ${stats.untested} untested`,
            details: stats,
            recommendations: this.getRecommendations()
        };
    }

    // Получить рекомендации
    getRecommendations() {
        const recommendations = [];
        
        if (this.stats.whiteListed === 0) {
            recommendations.push('No working proxies found. Start testing proxies.');
        }
        
        if (this.stats.successRate < 10) {
            recommendations.push('Low success rate. Consider getting better proxy sources.');
        }
        
        if (this.stats.untested > this.stats.whiteListed * 2) {
            recommendations.push('Many untested proxies available. Run proxy testing.');
        }
        
        if (this.stats.blackListed > this.stats.total * 0.8) {
            recommendations.push('Too many blocked proxies. Consider clearing blacklist for retesting.');
        }
        
        return recommendations;
    }
}

module.exports = ProxyManager;