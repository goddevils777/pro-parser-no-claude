// stable-connection-pool.js - Пул стабильных соединений для мониторинга
const logger = require('./logger');

class StableConnectionPool {
    constructor(truthSocialAPI) {
        this.truthSocialAPI = truthSocialAPI;
        this.connections = new Map(); // streamId -> {proxy, agent, lastUsed, successCount}
        this.healthyProxies = [];
        this.isInitialized = false;
    }

    // Инициализация пула стабильных соединений
    // Инициализация пула стабильных соединений
async initializePool(poolSize = 5) {
    logger.info(`🔧 Initializing stable connection pool (${poolSize} connections)...`);
    
    // Очищаем старые соединения
    this.connections.clear();
    
    // Тестируем и выбираем лучшие прокси
    this.healthyProxies = await this.findHealthyProxies(poolSize);
    
    if (this.healthyProxies.length < poolSize) {
        logger.warn(`⚠️ Found only ${this.healthyProxies.length} healthy proxies, need ${poolSize}`);
        
        // Если не хватает - ищем больше
        logger.info(`🔍 Searching for additional ${poolSize - this.healthyProxies.length} working proxies...`);
        const additionalProxies = await this.searchForMoreProxies(poolSize - this.healthyProxies.length);
        this.healthyProxies = this.healthyProxies.concat(additionalProxies);
    }
    
    // Создаем постоянные соединения
    for (let i = 0; i < Math.min(poolSize, this.healthyProxies.length); i++) {
        const proxy = this.healthyProxies[i];
        const agent = this.truthSocialAPI.createProxyAgent(proxy);
        
        this.connections.set(i, {
            proxy: proxy,
            agent: agent,
            lastUsed: 0,
            successCount: 0,
            errorCount: 0,
            isHealthy: true
        });
        
        logger.info(`✅ Connection #${i} ready: ${proxy.split('@')[0]}@***`);
    }
    
    this.isInitialized = true;
    logger.info(`🎯 Stable connection pool ready: ${this.connections.size}/${poolSize} connections`);
    
    return this.connections.size;
}

// Поиск дополнительных рабочих прокси
async searchForMoreProxies(needed) {
    const additionalProxies = [];
    const allProxies = this.truthSocialAPI.allProxies;
    const whiteList = this.truthSocialAPI.whiteList;
    const blackList = this.truthSocialAPI.blackList;
    
    // Тестируем неизвестные прокси
    const untestedProxies = allProxies.filter(proxy => 
        !whiteList.has(proxy) && !blackList.has(proxy)
    );
    
    logger.info(`🧪 Testing ${Math.min(needed * 3, untestedProxies.length)} untested proxies...`);
    
   for (let i = 0; i < Math.min(needed * 3, untestedProxies.length) && additionalProxies.length < needed; i++) {
    const proxy = untestedProxies[i];
    const remaining = needed - additionalProxies.length;
    
    logger.info(`🧪 Testing proxy ${i+1}/${Math.min(needed * 3, untestedProxies.length)}: ${proxy.split('@')[0]}@*** (need ${remaining} more)`);
    
    // Отправляем прогресс в веб
    if (global.io) {
        global.io.emit('log', {
            level: 'info',
            message: `🔍 Searching proxies: need ${remaining} more streams (testing ${i+1}/${Math.min(needed * 3, untestedProxies.length)})`
        });
    }
    
    if (await this.testProxyHealth(proxy)) {
        additionalProxies.push(proxy);
        await this.truthSocialAPI.addToWhiteList(proxy, 'pool_search');
        logger.info(`✅ Found working proxy ${additionalProxies.length}/${needed}: ${proxy.split('@')[0]}@***`);
        
        // Отправляем успех в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `✅ Found working proxy ${additionalProxies.length}/${needed}: streams remaining ${needed - additionalProxies.length}`
            });
        }
    } else {
        await this.truthSocialAPI.addToBlackList(proxy, 'pool_search_failed');
        
        // Отправляем неудачу в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'warning',
                message: `❌ Proxy failed test, continuing search... (${remaining} streams still needed)`
            });
        }
    }
    
    // Пауза между тестами
    if (i % 5 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}
    
    logger.info(`🎯 Found ${additionalProxies.length} additional working proxies`);
    return additionalProxies;
}
    // Поиск здоровых прокси
    // Поиск здоровых прокси
async findHealthyProxies(count) {
    const healthyProxies = [];
    const whiteList = Array.from(this.truthSocialAPI.whiteList);
    
    logger.info(`🔍 Testing proxies for stable connections...`);
    
    // Отправляем начальный статус в веб
    if (global.io) {
        global.io.emit('log', {
            level: 'info',
            message: `🔧 Initializing ${count} stable connections from ${whiteList.length} whitelisted proxies...`
        });
    }
    
    // Сначала проверяем белый список
    for (let i = 0; i < Math.min(count, whiteList.length); i++) {
        const proxy = whiteList[i];
        
        // Показываем прогресс в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🧪 Testing whitelisted proxy ${i+1}/${Math.min(count, whiteList.length)}: ${proxy.split('@')[0]}@***`
            });
        }
        
        if (await this.testProxyHealth(proxy)) {
            healthyProxies.push(proxy);
            logger.info(`✅ Healthy proxy: ${proxy.split('@')[0]}@***`);
            
            // Успех в веб
            if (global.io) {
                global.io.emit('log', {
                    level: 'success',
                    message: `✅ Connection ${healthyProxies.length}/${count} ready: ${proxy.split('@')[0]}@***`
                });
            }
        } else {
            // Неудача в веб
            if (global.io) {
                global.io.emit('log', {
                    level: 'warning',
                    message: `❌ Whitelisted proxy failed test: ${proxy.split('@')[0]}@***`
                });
            }
        }
    }
    
    return healthyProxies;
}

    // Тестирование здоровья прокси
// Тестирование здоровья прокси
async testProxyHealth(proxy) {
    try {
        const agent = this.truthSocialAPI.createProxyAgent(proxy);
        const testUrl = 'https://truthsocial.com/api/v1/instance';
        
        console.log(`🧪 Testing proxy health: ${proxy.split('@')[0]}@***`);
        
        const response = await this.truthSocialAPI.makeRequest(testUrl, {
            timeout: 5000,
            agent: agent
        });
        
        if (response.success) {
            console.log(`✅ Proxy healthy: ${proxy.split('@')[0]}@***`);
            return true;
        } else {
            console.log(`❌ Proxy failed health check: ${proxy.split('@')[0]}@***`);
            return false;
        }
        
    } catch (error) {
        console.log(`❌ Proxy health test error: ${proxy.split('@')[0]}@*** - ${error.message}`);
        return false;
    }
}

    // Получить стабильное соединение для потока
    getConnectionForStream(streamId) {
        if (!this.isInitialized) {
            return null;
        }
        
        const connection = this.connections.get(streamId % this.connections.size);
        
        if (connection) {
            connection.lastUsed = Date.now();
            return connection;
        }
        
        return null;
    }

    // Статистика пула
    getPoolStats() {
        const stats = {
            isInitialized: this.isInitialized,
            totalConnections: this.connections.size,
            healthyProxies: this.healthyProxies.length,
            connections: []
        };
        
        for (const [streamId, conn] of this.connections) {
            stats.connections.push({
                streamId: streamId,
                proxy: conn.proxy.split('@')[0] + '@***',
                successCount: conn.successCount,
                errorCount: conn.errorCount,
                lastUsed: conn.lastUsed
            });
        }
        
        return stats;
    }
}

module.exports = StableConnectionPool;