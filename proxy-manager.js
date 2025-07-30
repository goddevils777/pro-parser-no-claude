const fs = require('fs');
const logger = require('./logger');

class ProxyManager {
    constructor(proxyFile) {
        this.proxies = [];
        this.currentIndex = 0;
        this.failedProxies = new Set();
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
            logger.error('Failed to load proxies:', error);
        }
    }

    getNextProxy() {
        if (this.proxies.length === 0) return null;
        
        let attempts = 0;
        while (attempts < this.proxies.length) {
            const proxy = this.proxies[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
            
            if (!this.failedProxies.has(proxy)) {
                return proxy;
            }
            attempts++;
        }
        
        // Если все прокси провалились, сбрасываем failed список
        this.failedProxies.clear();
        return this.proxies[0];
    }

    markFailed(proxy) {
        this.failedProxies.add(proxy);
        logger.warn(`Proxy marked as failed: ${proxy.split('@')[1]}`);
    }

    getWorkingProxies(count = 20) {
        const result = [];
        for (let i = 0; i < count && i < this.proxies.length; i++) {
            result.push(this.getNextProxy());
        }
        return result;
    }
}

module.exports = ProxyManager;