// stable-connection-pool.js - ПОЛНАЯ ВЕРСИЯ
const logger = require('./logger');

class StableConnectionPool {
    constructor(truthSocialAPI) {
        this.truthSocialAPI = truthSocialAPI;
        this.connections = new Map();
        this.healthyProxies = [];
        this.isInitialized = false;
    }

    // Принудительный таймаут для запросов
    async requestWithTimeout(requestFunction, timeoutMs = 8000) {
        return Promise.race([
            requestFunction(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
            )
        ]);
    }

    async testProxyHealth(proxy) {
    const startTime = Date.now();
    const proxyShort = proxy.split('@')[0];
    
    try {
        // Логи в консоль с таймингом
        console.log(`🧪 [${new Date().toLocaleTimeString()}] Testing proxy: ${proxyShort}@***`);
        
        // Логи в веб-интерфейс
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🧪 Testing IP: ${proxyShort}@*** (${new Date().toLocaleTimeString()})`
            });
        }
        
        const agent = this.truthSocialAPI.createProxyAgent(proxy);
        const testUrl = 'https://truthsocial.com/api/v1/instance';
        
        // ТРОЙНАЯ ЗАЩИТА ОТ ЗАВИСАНИЯ
        const response = await Promise.race([
            // 1. Основной запрос
            this.truthSocialAPI.makeRequest(testUrl, {
                timeout: 3000, // Уменьшаем таймаут до 3 сек
                agent: agent
            }),
            
            // 2. Принудительный таймаут 5 секунд
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Hard timeout 5s')), 5000)
            ),
            
            // 3. Экстренный таймаут 8 секунд
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Emergency timeout 8s')), 8000)
            )
        ]);
        
        const testTime = Date.now() - startTime;
        
        if (response.success) {
            console.log(`✅ [${testTime}ms] Proxy healthy: ${proxyShort}@***`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'success',
                    message: `✅ IP working: ${proxyShort}@*** (${testTime}ms)`
                });
            }
            
            return true;
        } else {
            console.log(`❌ [${testTime}ms] Proxy failed: ${proxyShort}@***`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'warning',
                    message: `❌ IP failed: ${proxyShort}@*** (${testTime}ms)`
                });
            }
            
            return false;
        }
        
    } catch (error) {
        const testTime = Date.now() - startTime;
        console.log(`❌ [${testTime}ms] Proxy error: ${proxyShort}@*** - ${error.message}`);
        
        // Детальная диагностика зависаний
        if (testTime > 7000) {
            console.log(`🚨 SLOW PROXY DETECTED: ${proxyShort}@*** took ${testTime}ms`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `🚨 Slow IP detected: ${proxyShort}@*** (${testTime}ms) - may cause delays`
                });
            }
        }
        
        if (global.io) {
            global.io.emit('log', {
                level: 'warning',
                message: `❌ IP error: ${proxyShort}@*** - ${error.message} (${testTime}ms)`
            });
        }
        
        return false;
    }
}

// НОВАЯ ФУНКЦИЯ: Тестирование с глобальным таймаутом
async testProxiesInParallelWithTimeout(proxies, concurrency = 5, globalTimeoutMs = 60000) {
    const results = [];
    const startTime = Date.now();
    
    // Глобальный таймаут на всю операцию
    const globalTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Global search timeout after ${globalTimeoutMs/1000}s`)), globalTimeoutMs)
    );
    
    try {
        return await Promise.race([
            this.testProxiesInParallel(proxies, concurrency),
            globalTimeout
        ]);
    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.log(`🚨 SEARCH TIMEOUT: ${error.message} after ${elapsed}ms`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'error',
                message: `🚨 Search timeout after ${elapsed}ms - continuing with found IPs`
            });
        }
        
        return results; // Возвращаем что успели найти
    }
}

    // Параллельное тестирование прокси
    async testProxiesInParallel(proxies, concurrency = 5) {
        const results = [];
        
        // Разбиваем на группы для параллельного тестирования
        for (let i = 0; i < proxies.length; i += concurrency) {
            const batch = proxies.slice(i, i + concurrency);
            
            logger.info(`🧪 Testing batch ${Math.floor(i/concurrency) + 1}: ${batch.length} proxies...`);
            
            // Тестируем группу параллельно
            const batchPromises = batch.map(async proxy => {
                const isHealthy = await this.testProxyHealth(proxy);
                return { proxy, isHealthy };
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Обрабатываем результаты группы
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    logger.warn(`❌ Batch test failed: ${result.reason.message}`);
                }
            }
            
            // Небольшая пауза между группами
            if (i + concurrency < proxies.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        return results;
    }

    // НОВАЯ ФУНКЦИЯ: Поиск дополнительных прокси с логами
    async searchForMoreProxies(needed) {
    const searchStartTime = Date.now();
    const additionalProxies = [];
    const allProxies = this.truthSocialAPI.allProxies;
    const whiteList = this.truthSocialAPI.whiteList;
    const blackList = this.truthSocialAPI.blackList;
    
    const untestedProxies = allProxies.filter(proxy => 
        !whiteList.has(proxy) && !blackList.has(proxy)
    );
    
    const maxTests = Math.min(needed * 3, untestedProxies.length, 15); // Ограничиваем до 15 тестов
    
    logger.info(`🧪 Testing ${maxTests} untested proxies (timeout: 90s)...`);
    
    if (global.io) {
        global.io.emit('log', {
            level: 'info',
            message: `🔍 Searching ${needed} additional IPs (max ${maxTests} tests, 90s timeout)`
        });
    }
    
    // ЗАЩИТА ОТ ЗАВИСАНИЯ: глобальный таймаут 90 секунд
    const searchTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Search timeout 90s')), 90000)
    );
    
    try {
        const searchPromise = (async () => {
            for (let i = 0; i < maxTests && additionalProxies.length < needed; i++) {
                const proxy = untestedProxies[i];
                const remaining = needed - additionalProxies.length;
                const elapsed = Math.round((Date.now() - searchStartTime) / 1000);
                
                logger.info(`🧪 [${elapsed}s] Testing proxy ${i+1}/${maxTests}: ${proxy.split('@')[0]}@*** (need ${remaining} more)`);
                
                if (global.io) {
                    global.io.emit('log', {
                        level: 'info',
                        message: `🔍 [${elapsed}s] Testing IP ${i+1}/${maxTests}: need ${remaining} more`
                    });
                }
                
                // Тест с индивидуальным таймаутом
                const testResult = await this.testProxyHealth(proxy);
                
                if (testResult) {
                    additionalProxies.push(proxy);
                    await this.truthSocialAPI.addToWhiteList(proxy, 'pool_search');
                    logger.info(`✅ Found working proxy ${additionalProxies.length}/${needed}: ${proxy.split('@')[0]}@***`);
                    
                    if (global.io) {
                        global.io.emit('log', {
                            level: 'success',
                            message: `🎯 Found IP ${additionalProxies.length}/${needed}! Remaining: ${remaining - 1}`
                        });
                    }
                } else {
                    await this.truthSocialAPI.addToBlackList(proxy, 'pool_search_failed');
                }
                
                // Пауза между тестами (уменьшена)
                if (i % 3 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
            
            return additionalProxies;
        })();
        
        // Выполняем поиск с глобальным таймаутом
        await Promise.race([searchPromise, searchTimeout]);
        
    } catch (error) {
        const elapsed = Math.round((Date.now() - searchStartTime) / 1000);
        logger.warn(`⚠️ Search interrupted: ${error.message} after ${elapsed}s`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'warning',
                message: `⚠️ Search stopped after ${elapsed}s - found ${additionalProxies.length}/${needed} IPs`
            });
        }
    }
    
    const totalElapsed = Math.round((Date.now() - searchStartTime) / 1000);
    
    if (global.io) {
        global.io.emit('log', {
            level: additionalProxies.length > 0 ? 'success' : 'warning',
            message: `✅ Search complete (${totalElapsed}s): found ${additionalProxies.length}/${needed} additional IPs`
        });
    }
    
    logger.info(`🎯 Found ${additionalProxies.length} additional working proxies in ${totalElapsed}s`);
    return additionalProxies;
}

    // Инициализация пула
    async initializePool(poolSize = 5) {
        logger.info(`🔧 Initializing stable connection pool (${poolSize} connections)...`);
        
        this.connections.clear();
        
        // Получаем список прокси для тестирования
        const whiteList = Array.from(this.truthSocialAPI.whiteList);
        const allProxies = this.truthSocialAPI.allProxies;
        const blackList = this.truthSocialAPI.blackList;
        
        // 1. Сначала тестируем белый список параллельно
        let healthyProxies = [];
        
        if (whiteList.length > 0) {
            logger.info(`🔍 Testing ${Math.min(poolSize * 2, whiteList.length)} whitelisted proxies...`);
            
            const whitelistToTest = whiteList.slice(0, poolSize * 2);
            const whiteResults = await this.testProxiesInParallel(whitelistToTest, 5);
            
            healthyProxies = whiteResults
                .filter(result => result.isHealthy)
                .map(result => result.proxy);
            
            logger.info(`✅ Found ${healthyProxies.length} healthy whitelisted proxies`);
        }
        
        // 2. Если не хватает - ищем больше с помощью searchForMoreProxies
        if (healthyProxies.length < poolSize) {
            const needed = poolSize - healthyProxies.length;
            logger.info(`🔍 Need ${needed} more proxies, searching additional ones...`);
            
            const additionalProxies = await this.searchForMoreProxies(needed);
            healthyProxies = healthyProxies.concat(additionalProxies);
        }
        
        // 3. Создаем соединения
        const connectionsToCreate = Math.min(poolSize, healthyProxies.length);
        
        for (let i = 0; i < connectionsToCreate; i++) {
            const proxy = healthyProxies[i];
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
        logger.info(`🎯 Pool ready: ${this.connections.size}/${poolSize} connections`);
        
        return this.connections.size;
    }

    // Получить соединение для потока
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