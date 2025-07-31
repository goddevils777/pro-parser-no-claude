const fs = require('fs');
const logger = require('./logger');

class ProxyManager {
    constructor(proxyFile) {
        this.proxies = [];
        this.currentIndex = 0;
        this.loadProxies(proxyFile);
    }

    loadProxies(proxyFile) {
        try {
            const content = fs.readFileSync(proxyFile, 'utf8');
            this.proxies = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
            
            logger.info(`Loaded ${this.proxies.length} proxies`);
        } catch (error) {
            logger.error('Failed to load proxies:', error.message);
        }
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        
        // Берем случайный прокси вместо по очереди
        const randomIndex = Math.floor(Math.random() * this.proxies.length);
        return this.proxies[randomIndex];
    }

    parseProxy(proxyUrl) {
        try {
            const url = new URL(proxyUrl);
            return {
                server: `${url.hostname}:${url.port}`,
                username: url.username,
                password: url.password
            };
        } catch (error) {
            logger.error('Failed to parse proxy:', error.message);
            return null;
        }
    }
}

module.exports = ProxyManager;