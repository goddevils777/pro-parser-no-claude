// parallel-monitor.js - Менеджер параллельных потоков мониторинга
const logger = require('./logger');

class ParallelMonitor {
    constructor(truthSocialAPI, postCallback, connectionPool) {
        this.truthSocialAPI = truthSocialAPI;
        this.postCallback = postCallback;
        this.connectionPool = connectionPool; // ← добавляем пул соединений
        this.streams = new Map();
        this.lastPostIds = new Map();
        this.isRunning = false;
        this.profiles = [];
        
// Настройки параллельных потоков (оптимальные для избежания блокировок)
this.streamCount = 20; // ← 30 потоков на пользователя (в 2 раза больше)
this.streamInterval = 20000; // 15 секунд между запросами
this.startDelay = 400; // 0.5 секунды задержка между потоками
    }

  // Запуск параллельного мониторинга 
async startParallelMonitoring(profiles) {
    if (this.isRunning) {
        logger.warn('⚠️ Parallel monitoring already running');
        return { success: false, error: 'Already running' };
    }

    this.profiles = profiles;
    
    const streamsPerProfile = this.streamCount; // ← используем значение из конструктора
    const totalStreamsNeeded = profiles.length * streamsPerProfile;

    logger.info(`🚀 Starting ${streamsPerProfile} streams for EACH of ${profiles.length} users (total: ${totalStreamsNeeded} streams)...`);
    
    // Инициализируем пул стабильных соединений
    logger.info(`🔧 Initializing stable connection pool for ${totalStreamsNeeded} streams...`);
    const connectionsReady = await this.connectionPool.initializePool(totalStreamsNeeded);
    
    if (connectionsReady < totalStreamsNeeded) {
        logger.warn(`⚠️ Only ${connectionsReady} stable connections available, continuing with available connections`);
        // Пересчитываем потоки на пользователя
        const actualStreamsPerProfile = Math.floor(connectionsReady / profiles.length);
        logger.info(`📊 Adjusted to ${actualStreamsPerProfile} streams per profile`);
    }
    
    this.isRunning = true;

    logger.info(`🚀 Starting ${streamsPerProfile} parallel monitoring streams per user...`);
    logger.info(`📊 Settings: ${streamsPerProfile} streams × ${this.streamInterval/1000}s interval = ~${this.streamInterval/streamsPerProfile/1000}s effective rate`);

    let streamId = 0;
    
    // Запускаем потоки для каждого пользователя
    for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
        const profile = profiles[profileIndex];
        
        logger.info(`👤 Starting ${streamsPerProfile} dedicated streams for @${profile.username}...`);
        
        // 10 потоков для этого пользователя
        for (let userStreamIndex = 0; userStreamIndex < streamsPerProfile; userStreamIndex++) {
            const delay = streamId * this.startDelay; // задержка между всеми потоками
            const currentStreamId = streamId;
            
            logger.info(`🚀 Scheduling stream #${currentStreamId} for @${profile.username} with ${delay}ms delay`);
            
            setTimeout(() => {
                this.startUserDedicatedStream(currentStreamId, profile.username, userStreamIndex);
            }, delay);
            
            streamId++;
        }
    }

    logger.info(`📊 Total streams scheduled: ${streamId}`);

    return {
        success: true,
        message: `Started ${streamsPerProfile} streams for each of ${profiles.length} users`,
        totalStreams: streamId,
        streamsPerProfile: streamsPerProfile,
        profilesCount: profiles.length,
        effectiveRatePerProfile: Math.round(this.streamInterval / streamsPerProfile)
    };
}

// Запуск выделенного потока для пользователя
startUserDedicatedStream(streamId, username, userStreamIndex) {
    logger.info(`🔄 Starting dedicated stream #${streamId} for @${username} (user stream ${userStreamIndex})`);

    const streamMonitor = async () => {
        await this.monitorSingleProfile(streamId, username, userStreamIndex);
    };

    // Первый запуск сразу
    streamMonitor();

    // Устанавливаем интервал
    const intervalId = setInterval(streamMonitor, this.streamInterval);
    this.streams.set(streamId, intervalId); // ← используем правильный streamId

    logger.info(`✅ Dedicated stream #${streamId} started for @${username} (every ${this.streamInterval/1000}s)`);
}

    // Запуск одного потока мониторинга
    startMonitoringStream(streamId) {
        logger.info(`🔄 Starting monitoring stream #${streamId}`);

        const streamMonitor = async () => {
            const startTime = Date.now();
            
            try {
                // Мониторим все профили в этом потоке
                for (const profile of this.profiles) {
                    await this.monitorProfileInStream(profile.username, streamId);
                }

                const duration = Date.now() - startTime;
                logger.info(`⚡ Stream #${streamId} completed cycle in ${duration}ms (${this.profiles.length} profiles)`);

            } catch (error) {
                logger.error(`❌ Stream #${streamId} error: ${error.message}`);
            }
        };

        // Первый запуск сразу
        streamMonitor();

        // Устанавливаем интервал
        const intervalId = setInterval(streamMonitor, this.streamInterval);
        this.streams.set(streamId, intervalId);

        logger.info(`✅ Stream #${streamId} started (every ${this.streamInterval/1000}s)`);
    }


    // Мониторинг одного профиля в выделенном потоке
async monitorSingleProfile(streamId, username, userStreamIndex) {
    const streamKey = `${username}_stream${streamId}`;
    const startTime = Date.now();

    try {
        logger.info(`🔍 Stream #${streamId}: Checking @${username} (user stream ${userStreamIndex})...`);

        // Получаем стабильное соединение для этого потока
        const connection = this.connectionPool.getConnectionForStream(streamId);
        
        if (!connection) {
            logger.warn(`⚠️ Stream #${streamId}: No stable connection available, searching for new proxy...`);
            await this.replaceFailedConnection(streamId);
            return;
        }

        // Получаем последний пост
        const result = await this.truthSocialAPI.getUserPosts(username, 1);
        const responseTime = Date.now() - startTime;

        if (result.success && result.posts.length > 0) {
            const latestPost = result.posts[0];
            const lastPostId = this.lastPostIds.get(streamKey);
            const isNewPost = lastPostId !== latestPost.id;

            // ВСЕГДА отправляем результат проверки в callback
            if (this.postCallback) {
                this.postCallback({
                    type: isNewPost ? 'new_post' : 'check_result',
                    profile: username,
                    post: latestPost,
                    foundAt: new Date().toISOString(),
                    streamId: streamId,
                    userStreamIndex: userStreamIndex,
                    responseTime: responseTime,
                    method: result.method,
                    isNewPost: isNewPost
                });
            }

            if (isNewPost) {
                // Обновляем ID последнего поста для этого потока
                this.lastPostIds.set(streamKey, latestPost.id);
                if (connection) connection.successCount++;

                logger.info(`🎯 Stream #${streamId}: NEW POST from @${username}! (user stream ${userStreamIndex}, ${responseTime}ms)`);
                logger.info(`📝 Content: "${latestPost.content.substring(0, 100)}..."`);
            } else {
                if (connection) connection.successCount++;
                logger.info(`✅ Stream #${streamId}: @${username} no new posts (user stream ${userStreamIndex}, ${responseTime}ms)`);
            }
        } else {
            if (connection) connection.errorCount++;
            logger.warn(`⚠️ Stream #${streamId}: Failed to get posts for @${username}: ${result.error}`);
            
            // Проверяем нужно ли заменить соединение
            if (connection && connection.errorCount > 3) {
                logger.info(`🔄 Stream #${streamId}: Too many errors, replacing connection...`);
                await this.replaceFailedConnection(streamId);
            }
            
            // Отправляем результат ошибки
            if (this.postCallback) {
                this.postCallback({
                    type: 'error',
                    profile: username,
                    foundAt: new Date().toISOString(),
                    streamId: streamId,
                    userStreamIndex: userStreamIndex,
                    responseTime: responseTime,
                    error: result.error
                });
            }
        }

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Stream #${streamId}: Error monitoring @${username} (${responseTime}ms): ${error.message}`);
    }
} 

// Поиск дополнительных рабочих прокси
async findMoreWorkingProxies(needed) {
    logger.info(`🔍 Searching for ${needed} more working proxies...`);
    
    const allProxies = this.truthSocialAPI.allProxies;
    const whiteList = this.truthSocialAPI.whiteList;
    const blackList = this.truthSocialAPI.blackList;
    
    // Тестируем неизвестные прокси
    const untestedProxies = allProxies.filter(proxy => 
        !whiteList.has(proxy) && !blackList.has(proxy)
    );
    
    let found = 0;
    
    for (const proxy of untestedProxies) {
        if (found >= needed) break;
        
        logger.info(`🧪 Testing proxy: ${proxy.split('@')[0]}@***`);
        
        try {
            const agent = this.truthSocialAPI.createProxyAgent(proxy);
            const testUrl = 'https://truthsocial.com/api/v1/instance';
            
            const startTime = Date.now();
            const response = await this.truthSocialAPI.makeRequest(testUrl, {
                timeout: 5000,
                agent: agent
            });
            const testTime = Date.now() - startTime;
            
            if (response.success) {
                // Добавляем в белый список
                await this.truthSocialAPI.addToWhiteList(proxy, 'manual_test');
                logger.info(`✅ Found working proxy: ${proxy.split('@')[0]}@*** (${testTime}ms)`);
                found++;
            } else {
                // Добавляем в черный список
                await this.truthSocialAPI.addToBlackList(proxy, 'manual_test_failed');
                logger.warn(`❌ Proxy failed: ${proxy.split('@')[0]}@***`);
            }
            
        } catch (error) {
            await this.truthSocialAPI.addToBlackList(proxy, 'manual_test_error');
            logger.warn(`❌ Proxy error: ${proxy.split('@')[0]}@*** - ${error.message}`);
        }
        
        // Пауза между тестами
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.info(`🎯 Found ${found} additional working proxies`);
    return found;
}

// Замена неудачного соединения
async replaceFailedConnection(streamId) {
    logger.info(`🔄 Replacing failed connection for stream #${streamId}...`);
    
    // Ищем новый рабочий прокси
    const newProxiesFound = await this.findMoreWorkingProxies(1);
    
    if (newProxiesFound > 0) {
        // Пересоздаем пул соединений
        await this.connectionPool.initializePool(this.streams.size);
        logger.info(`✅ Stream #${streamId}: Connection replaced successfully`);
    } else {
        logger.warn(`⚠️ Stream #${streamId}: No replacement proxy found`);
    }
}

    // Мониторинг профиля в конкретном потоке
async monitorProfileInStream(username, streamId) {
    const streamKey = `${username}_stream${streamId}`;
    const startTime = Date.now();

    try {
        logger.info(`🔍 Stream #${streamId}: Checking @${username}...`);

        // Получаем последний пост
        const result = await this.truthSocialAPI.getUserPosts(username, 1);
        const responseTime = Date.now() - startTime;

        if (result.success && result.posts.length > 0) {
            const latestPost = result.posts[0];
            const lastPostId = this.lastPostIds.get(streamKey);
            const isNewPost = lastPostId !== latestPost.id;

            // ВСЕГДА отправляем результат проверки в callback
            if (this.postCallback) {
                this.postCallback({
                    type: isNewPost ? 'new_post' : 'check_result',
                    profile: username,
                    post: latestPost,
                    foundAt: new Date().toISOString(),
                    streamId: streamId,
                    responseTime: responseTime,
                    method: result.method,
                    isNewPost: isNewPost
                });
            }

            if (isNewPost) {
                // Обновляем ID последнего поста для этого потока
                this.lastPostIds.set(streamKey, latestPost.id);
                logger.info(`🎯 Stream #${streamId}: NEW POST from @${username}! Response time: ${responseTime}ms`);
                logger.info(`📝 Content: "${latestPost.content.substring(0, 100)}..."`);
                logger.info(`⏰ Created: ${latestPost.createdAt}`);
            } else {
                logger.info(`✅ Stream #${streamId}: @${username} no new posts (${responseTime}ms)`);
            }
        } else {
            logger.warn(`⚠️ Stream #${streamId}: Failed to get posts for @${username}: ${result.error}`);
            
            // Отправляем результат ошибки
            if (this.postCallback) {
                this.postCallback({
                    type: 'error',
                    profile: username,
                    foundAt: new Date().toISOString(),
                    streamId: streamId,
                    responseTime: responseTime,
                    error: result.error
                });
            }
        }

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Stream #${streamId}: Error monitoring @${username} (${responseTime}ms): ${error.message}`);
    }
}

    // Остановка всех потоков
    stopParallelMonitoring() {
        if (!this.isRunning) {
            return { success: false, error: 'Not running' };
        }

        logger.info(`🛑 Stopping ${this.streams.size} monitoring streams...`);

        // Останавливаем все потоки
        for (const [streamId, intervalId] of this.streams) {
            clearInterval(intervalId);
            logger.info(`⏹️ Stream #${streamId} stopped`);
        }

        this.streams.clear();
        this.lastPostIds.clear();
        this.isRunning = false;

        logger.info(`✅ All parallel monitoring streams stopped`);

        return {
            success: true,
            message: 'All streams stopped',
            stoppedStreams: this.streamCount
        };
    }

    // Получение статистики потоков
    getStats() {
        return {
            isRunning: this.isRunning,
            activeStreams: this.streams.size,
            streamCount: this.streamCount,
            streamInterval: this.streamInterval,
            effectiveRate: this.isRunning ? Math.round(this.streamInterval / this.streamCount) : 0,
            profilesCount: this.profiles.length,
            totalRequestsPerMinute: this.isRunning ? Math.round((60000 / this.streamInterval) * this.streamCount * this.profiles.length) : 0
        };
    }

    // Изменение настроек потоков (без перезапуска)
    updateSettings(newStreamCount = null, newInterval = null) {
        if (newStreamCount && newStreamCount !== this.streamCount) {
            this.streamCount = newStreamCount;
            logger.info(`🔧 Updated stream count to: ${this.streamCount}`);
        }

        if (newInterval && newInterval !== this.streamInterval) {
            this.streamInterval = newInterval;
            logger.info(`🔧 Updated stream interval to: ${this.streamInterval}ms`);
        }

        return this.getStats();
    }
}

module.exports = ParallelMonitor;