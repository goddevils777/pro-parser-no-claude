// Заменить класс ProxyManager в proxy-manager.js
class ProxyManager {
    constructor(proxyListPath) {
        this.proxyListPath = proxyListPath;
        this.proxies = [];
        this.currentIndex = 0;
        this.workingProxies = new Set(); // Вайтлист - проверенные рабочие IP
        this.blacklistedProxies = new Set(); // Блэклист - заблокированные IP
        this.usedProxies = new Set(); // Список IP используемых активными браузерами
        this.lastUsedIndex = new Map(); // Отслеживание последнего использования IP
        this.loadProxies();
        this.loadWorkingProxies();
        this.loadBlacklistedProxies();
    }

    // Загрузка сохраненных рабочих IP из файла
    async loadWorkingProxies() {
        try {
            const fs = require('fs-extra');
            const workingProxiesPath = './data/working-proxies.json';
            
            if (await fs.pathExists(workingProxiesPath)) {
                const workingProxiesList = await fs.readJson(workingProxiesPath);
                this.workingProxies = new Set(workingProxiesList);
                console.log(`📋 Loaded ${this.workingProxies.size} working IP addresses (whitelist)`);
            }
        } catch (error) {
            console.warn(`Failed to load working proxies: ${error.message}`);
        }
    }

    // Загрузка заблокированных IP из файла
    async loadBlacklistedProxies() {
        try {
            const fs = require('fs-extra');
            const blacklistedProxiesPath = './data/blacklisted-proxies.json';
            
            if (await fs.pathExists(blacklistedProxiesPath)) {
                const blacklistedProxiesList = await fs.readJson(blacklistedProxiesPath);
                this.blacklistedProxies = new Set(blacklistedProxiesList);
                console.log(`📋 Loaded ${this.blacklistedProxies.size} blacklisted IP addresses`);
            }
        } catch (error) {
            console.warn(`Failed to load blacklisted proxies: ${error.message}`);
        }
    }

    // Сохранение рабочих IP в файл
    async saveWorkingProxies() {
        try {
            const fs = require('fs-extra');
            await fs.ensureDir('./data');
            const workingProxiesList = Array.from(this.workingProxies);
            await fs.writeJson('./data/working-proxies.json', workingProxiesList);
            console.log(`💾 Saved ${workingProxiesList.length} working IP addresses (whitelist)`);
        } catch (error) {
            console.error(`Failed to save working proxies: ${error.message}`);
        }
    }

    // Сохранение заблокированных IP в файл
    async saveBlacklistedProxies() {
        try {
            const fs = require('fs-extra');
            await fs.ensureDir('./data');
            const blacklistedProxiesList = Array.from(this.blacklistedProxies);
            await fs.writeJson('./data/blacklisted-proxies.json', blacklistedProxiesList);
            console.log(`💾 Saved ${blacklistedProxiesList.length} blacklisted IP addresses`);
        } catch (error) {
            console.error(`Failed to save blacklisted proxies: ${error.message}`);
        }
    }

    // Добавление IP в вайтлист
    async addWorkingProxy(proxyUrl) {
        if (proxyUrl && !this.workingProxies.has(proxyUrl)) {
            this.workingProxies.add(proxyUrl);
            // Удаляем из блэклиста если добавляем в вайтлист
            if (this.blacklistedProxies.has(proxyUrl)) {
                this.blacklistedProxies.delete(proxyUrl);
                await this.saveBlacklistedProxies();
            }
            await this.saveWorkingProxies();
            console.log(`✅ Added working IP to whitelist: ${proxyUrl}`);
        }
    }

    // Добавление IP в блэклист
    async addBlacklistedProxy(proxyUrl, reason = 'blocked') {
        if (proxyUrl && !this.blacklistedProxies.has(proxyUrl)) {
            this.blacklistedProxies.add(proxyUrl);
            // Удаляем из вайтлиста если добавляем в блэклист
            if (this.workingProxies.has(proxyUrl)) {
                this.workingProxies.delete(proxyUrl);
                await this.saveWorkingProxies();
            }
            await this.saveBlacklistedProxies();
            console.log(`❌ Added IP to blacklist (${reason}): ${proxyUrl}`);
        }
    }

    // Удаление IP из вайтлиста (если перестал работать)
    async removeWorkingProxy(proxyUrl) {
        if (proxyUrl && this.workingProxies.has(proxyUrl)) {
            this.workingProxies.delete(proxyUrl);
            // Автоматически добавляем в блэклист
            await this.addBlacklistedProxy(proxyUrl, 'stopped working');
            console.log(`❌ Moved IP from whitelist to blacklist: ${proxyUrl}`);
        }
    }

    // Пометить IP как используемый
    markProxyAsUsed(proxyUrl) {
        if (proxyUrl) {
            this.usedProxies.add(proxyUrl);
            this.lastUsedIndex.set(proxyUrl, Date.now());
            console.log(`🔒 Marked IP as used: ${proxyUrl} (${this.usedProxies.size} IPs in use)`);
        }
    }

    // Освободить IP (когда браузер закрывается)
    releaseProxy(proxyUrl) {
        if (proxyUrl && this.usedProxies.has(proxyUrl)) {
            this.usedProxies.delete(proxyUrl);
            console.log(`🔓 Released IP: ${proxyUrl} (${this.usedProxies.size} IPs in use)`);
        }
    }

    // Получение следующего прокси с улучшенной логикой
    getNextProxy() {
        if (this.proxies.length === 0) return null;

        // Фильтруем доступные IP (не в блэклисте, не используемые)
        const availableProxies = this.proxies.filter(ip => 
            !this.blacklistedProxies.has(ip) && !this.usedProxies.has(ip)
        );

        if (availableProxies.length === 0) {
            console.warn(`⚠️ No available IPs! Total: ${this.proxies.length}, Blacklisted: ${this.blacklistedProxies.size}, Used: ${this.usedProxies.size}`);
            
            // В крайнем случае берем любой IP (даже используемый, но не заблокированный)
            const notBlacklisted = this.proxies.filter(ip => !this.blacklistedProxies.has(ip));
            if (notBlacklisted.length > 0) {
                const proxy = notBlacklisted[this.currentIndex % notBlacklisted.length];
                this.currentIndex++;
                console.log(`🔄 Using non-blacklisted IP (may be in use): ${proxy}`);
                return proxy;
            }
            
            return null;
        }

        // 1. Приоритет: рабочие IP из вайтлиста (доступные)
        const availableWorkingProxies = availableProxies.filter(ip => this.workingProxies.has(ip));
        
        if (availableWorkingProxies.length > 0) {
            // Выбираем наименее недавно использованный рабочий IP
            const sortedWorking = availableWorkingProxies.sort((a, b) => {
                const timeA = this.lastUsedIndex.get(a) || 0;
                const timeB = this.lastUsedIndex.get(b) || 0;
                return timeA - timeB;
            });
            
            const proxy = sortedWorking[0];
            console.log(`🎯 Using priority working IP: ${proxy} (${availableWorkingProxies.length} working IPs available)`);
            return proxy;
        }

        // 2. Обычные доступные IP
        // Равномерно распределяем по всем доступным IP
        const proxy = availableProxies[this.currentIndex % availableProxies.length];
        this.currentIndex++;
        
        console.log(`🔄 Using regular available IP: ${proxy} (${availableProxies.length} IPs available)`);
        return proxy;
    }

    // Получить детальную статистику IP
    getProxiesStats() {
        const totalProxies = this.proxies.length;
        const blacklisted = this.blacklistedProxies.size;
        const working = this.workingProxies.size;
        const used = this.usedProxies.size;
        const available = this.proxies.filter(ip => 
            !this.blacklistedProxies.has(ip) && !this.usedProxies.has(ip)
        ).length;

        return {
            total: totalProxies,
            working: working,
            blacklisted: blacklisted,
            used: used,
            available: available,
            workingPercentage: totalProxies > 0 ? Math.round((working / totalProxies) * 100) : 0,
            blacklistedPercentage: totalProxies > 0 ? Math.round((blacklisted / totalProxies) * 100) : 0,
            availablePercentage: totalProxies > 0 ? Math.round((available / totalProxies) * 100) : 0
        };
    }

    // Очистка блэклиста (для администрирования)
    async clearBlacklist() {
        this.blacklistedProxies.clear();
        await this.saveBlacklistedProxies();
        console.log(`🗑️ Blacklist cleared`);
    }

    // Остальные методы остаются без изменений...
    loadProxies() {
        try {
            const fs = require('fs');
            const data = fs.readFileSync(this.proxyListPath, 'utf8');
            this.proxies = data.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);
            console.log(`Loaded ${this.proxies.length} proxies`);
        } catch (error) {
            console.error('Failed to load proxies:', error.message);
            this.proxies = [];
        }
    }

    parseProxy(proxyUrl) {
        if (!proxyUrl) return null;
        
        try {
            const url = new URL(proxyUrl);
            return {
                server: `${url.hostname}:${url.port}`,
                username: url.username,
                password: url.password
            };
        } catch (error) {
            console.error('Failed to parse proxy:', proxyUrl);
            return null;
        }
    }
}


module.exports = ProxyManager;