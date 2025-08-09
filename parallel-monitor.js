// parallel-monitor.js - Менеджер параллельных потоков мониторинга
const logger = require('./logger');

class ParallelMonitor {
    constructor(truthSocialAPI, postCallback, connectionPool) {
        this.truthSocialAPI = truthSocialAPI;
        this.postCallback = postCallback;
        this.connectionPool = connectionPool;
        this.streams = new Map();
        this.lastPostIds = new Map();
        this.isRunning = false;
        this.profiles = [];
        
        // Глобальное отслеживание
        this.globalLastPostIds = new Map();
        this.postUpdateLock = new Map();
        
        // УЛЬТРА-АГРЕССИВНЫЕ НАСТРОЙКИ ДЛЯ МГНОВЕННОГО ОБНАРУЖЕНИЯ
        this.streamCount = 25; // Увеличиваем до 25 потоков
        this.streamInterval = 8000; // 8 секунд (8000 / 25 = 320ms эффективно!)
        this.startDelay = 200; // Каждые 200ms запускается новый поток
        this.maxErrorsBeforeReplace = 1; // Мгновенная замена при ошибке
        this.cooldownAfterError = 1000; // 1 секунда пауза
        
        // СИСТЕМА МГНОВЕННОГО ОБНАРУЖЕНИЯ
        this.turboMode = true; // Турбо режим включен
        this.minGapBetweenRequests = 200; // Минимум 200ms между запросами
        this.lastRequestTimes = new Map();
        this.detectionHistory = []; // История обнаружения для оптимизации
    }

    // ИСПРАВЛЕННАЯ функция запуска параллельного мониторинга
    async startParallelMonitoring(profiles) {
        if (this.isRunning) {
            logger.warn('⚠️ Parallel monitoring already running');
            return { success: false, error: 'Already running' };
        }

        this.profiles = profiles;
        
        const streamsPerProfile = this.streamCount;
        const totalStreamsNeeded = profiles.length * streamsPerProfile;

        logger.info(`🚀 TURBO MODE: Starting ${streamsPerProfile} streams for EACH of ${profiles.length} users (total: ${totalStreamsNeeded} streams)...`);
        logger.info(`⚡ Target speed: ${this.streamInterval / this.streamCount}ms between checks`);
        
        // 1. Инициализируем пул стабильных соединений
        logger.info(`🔧 Initializing stable connection pool for ${totalStreamsNeeded} streams...`);
        const connectionsReady = await this.connectionPool.initializePool(totalStreamsNeeded);
        
        if (connectionsReady < totalStreamsNeeded) {
            logger.warn(`⚠️ Only ${connectionsReady} stable connections available, continuing with available connections`);
            const actualStreamsPerProfile = Math.floor(connectionsReady / profiles.length);
            logger.info(`📊 Adjusted to ${actualStreamsPerProfile} streams per profile`);
        }
        
        // 2. ЗАПУСКАЕМ ФАКТИЧЕСКИЙ МОНИТОРИНГ
        this.isRunning = true;

        logger.info(`🚀 Starting ${streamsPerProfile} TURBO monitoring streams per user...`);
        logger.info(`📊 Settings: ${streamsPerProfile} streams × ${this.streamInterval/1000}s interval = ~${this.streamInterval/streamsPerProfile}ms effective rate`);

        let streamId = 0;
        
        // Запускаем потоки для каждого пользователя
        for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++) {
            const profile = profiles[profileIndex];
            
            logger.info(`👤 Starting ${streamsPerProfile} TURBO streams for @${profile.username}...`);
            
            // Отправляем прогресс в веб
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `👤 Creating ${streamsPerProfile} TURBO streams for @${profile.username}...`
                });
            }
            
            // Запускаем потоки для этого пользователя
            for (let userStreamIndex = 0; userStreamIndex < streamsPerProfile; userStreamIndex++) {
                const delay = streamId * this.startDelay;
                const currentStreamId = streamId;
                
                logger.info(`🚀 Scheduling TURBO stream #${currentStreamId} for @${profile.username} with ${delay}ms delay`);
                
                // Отправляем прогресс в веб
                if (global.io) {
                    global.io.emit('log', {
                        level: 'success',
                        message: `⚡ TURBO Stream #${currentStreamId} scheduled for @${profile.username} (${streamId + 1}/${totalStreamsNeeded} total)`
                    });
                }
                
                setTimeout(() => {
                    this.startUserDedicatedStream(currentStreamId, profile.username, userStreamIndex);
                }, delay);
                
                streamId++;
            }
        }

        logger.info(`📊 Total TURBO streams scheduled: ${streamId}`);
        logger.info(`✅ TURBO monitoring started successfully!`);
        
        // Отправляем финальный статус в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `🎯 All ${streamId} TURBO streams scheduled! INSTANT detection in ${(streamId * this.startDelay)/1000} seconds`
            });
        }

        return {
            success: true,
            message: `Started ${streamId} TURBO streams for ${profiles.length} profiles`,
            streamCount: streamId,
            streamsPerProfile: streamsPerProfile,
            totalStreams: streamId,
            profilesCount: profiles.length,
            effectiveRatePerProfile: Math.round(this.streamInterval / streamsPerProfile),
            turboMode: this.turboMode
        };
    }

    // Запуск выделенного потока для пользователя
    startUserDedicatedStream(streamId, username, userStreamIndex) {
        logger.info(`🔄 Starting TURBO stream #${streamId} for @${username} (user stream ${userStreamIndex})`);

        const streamMonitor = async () => {
            await this.monitorSingleProfile(streamId, username, userStreamIndex);
        };

        // Первый запуск сразу
        streamMonitor();

        // Устанавливаем интервал
        const intervalId = setInterval(streamMonitor, this.streamInterval);
        this.streams.set(streamId, intervalId);

        logger.info(`✅ TURBO stream #${streamId} started for @${username} (every ${this.streamInterval/1000}s)`);
    }

    // ЭКСТРЕННОЕ обновление всех потоков при новом посте
    async emergencyGlobalSync(username, newPostId, discovererStreamId) {
        logger.info(`🚨 EMERGENCY SYNC: New post detected by Stream #${discovererStreamId}!`);
        
        // Немедленно обновляем все потоки
        let syncedStreams = 0;
        for (let i = 0; i < this.streamCount; i++) {
            const streamKey = `${username}_stream${i}`;
            this.lastPostIds.set(streamKey, newPostId);
            syncedStreams++;
        }
        
        // Записываем время обнаружения
        this.detectionHistory.push({
            username: username,
            postId: newPostId,
            discoveredBy: discovererStreamId,
            detectedAt: Date.now(),
            syncedStreams: syncedStreams
        });
        
        // Оставляем только последние 10 записей
        if (this.detectionHistory.length > 10) {
            this.detectionHistory.shift();
        }
        
        logger.info(`🚨 EMERGENCY SYNC COMPLETE: ${syncedStreams} streams updated instantly!`);
        
        // Отправляем экстренное уведомление в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `🚨 INSTANT DETECTION: Stream #${discovererStreamId} found new post → ${syncedStreams} streams synced!`
            });
        }
        
        return syncedStreams;
    }

    // УЛУЧШЕННАЯ функция updateGlobalLastPostId с экстренной синхронизацией
    updateGlobalLastPostId(username, newPostId, discovererStreamId) {
        const currentGlobalId = this.globalLastPostIds.get(username);
        
        logger.info(`🔍 TURBO check @${username}: current="${currentGlobalId}" new="${newPostId}" by Stream #${discovererStreamId}`);
        
        if (currentGlobalId !== newPostId) {
            // ЭКСТРЕННАЯ БЛОКИРОВКА - только 300ms защита от дублей (ускорено!)
            const lockKey = `${username}_update`;
            const now = Date.now();
            const lastUpdate = this.postUpdateLock.get(lockKey) || 0;
            
            if (now - lastUpdate < 300) { // Уменьшили до 300ms для ТУРБО
                logger.info(`🔒 Update blocked for @${username}: too recent (${now - lastUpdate}ms ago)`);
                return false;
            }
            
            // Обновляем глобальный ID
            this.globalLastPostIds.set(username, newPostId);
            this.postUpdateLock.set(lockKey, now);
            
            // ЭКСТРЕННАЯ СИНХРОНИЗАЦИЯ ВСЕХ ПОТОКОВ
            this.emergencyGlobalSync(username, newPostId, discovererStreamId);
            
            return true; // Это новый пост
        }
        
        return false; // Пост уже известен
    }

    // ТУРБО контроль времени
    async turboTimingControl(streamId) {
        const now = Date.now();
        const lastRequest = this.lastRequestTimes.get(streamId) || 0;
        const actualGap = now - lastRequest;
        
        // В турбо режиме - минимальные задержки
        if (actualGap < this.minGapBetweenRequests) {
            const waitTime = this.minGapBetweenRequests - actualGap;
            logger.info(`⚡ Stream #${streamId}: Turbo delay ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTimes.set(streamId, Date.now());
    }

    // УЛЬТРА-БЫСТРАЯ функция мониторинга
    async monitorSingleProfile(streamId, username, userStreamIndex) {
        // ТУРБО КОНТРОЛЬ ВРЕМЕНИ
        await this.turboTimingControl(streamId);
        
        const startTime = Date.now();

        try {
            // Получаем стабильное соединение для этого потока
            const connection = this.connectionPool.getConnectionForStream(streamId);
            
            if (!connection) {
                logger.warn(`⚠️ Stream #${streamId}: No connection - searching replacement...`);
                await this.ultraFastReplaceConnection(streamId);
                return;
            }

            // БЫСТРЫЙ ЗАПРОС ПОСТОВ
            const result = await this.truthSocialAPI.getUserPostsWithConnection(username, 1, connection);
            const responseTime = Date.now() - startTime;

            if (result.success && result.posts.length > 0) {
                const latestPost = result.posts[0];
                
                // МГНОВЕННАЯ ПРОВЕРКА НОВИЗНЫ с указанием первооткрывателя
                const isGloballyNewPost = this.updateGlobalLastPostId(username, latestPost.id, streamId);
                
                // Отправляем результат в callback
                if (this.postCallback) {
                    this.postCallback({
                        type: isGloballyNewPost ? 'new_post' : 'check_result',
                        profile: username,
                        post: latestPost,
                        foundAt: new Date().toISOString(),
                        streamId: streamId,
                        userStreamIndex: userStreamIndex,
                        responseTime: responseTime,
                        method: result.method,
                        isNewPost: isGloballyNewPost,
                        turboMode: this.turboMode,
                        discoveredBy: isGloballyNewPost ? streamId : null
                    });
                }

                if (isGloballyNewPost) {
                    if (connection) connection.successCount++;
                    logger.info(`🎯 Stream #${streamId}: ⚡ INSTANT NEW POST! "${latestPost.content.substring(0, 40)}..." (${responseTime}ms)`);
                    
                    // Экстренное уведомление в веб
                    if (global.io) {
                        global.io.emit('log', {
                            level: 'success',
                            message: `⚡ INSTANT: Stream #${streamId} found NEW POST in ${responseTime}ms!`
                        });
                    }
                } else {
                    if (connection) connection.successCount++;
                    logger.info(`✅ Stream #${streamId}: Known post (${responseTime}ms)`);
                }
            } else {
                // БЫСТРАЯ ЗАМЕНА IP при ошибках
                if (connection) connection.errorCount++;
                
                const isTimeoutError = result.error && (
                    result.error.includes('ETIMEDOUT') ||
                    result.error.includes('timeout') ||
                    result.error.includes('ECONNRESET') ||
                    result.error.includes('RequestError')
                );

                if (connection && (connection.errorCount >= this.maxErrorsBeforeReplace || isTimeoutError)) {
                    logger.info(`⚡ Stream #${streamId}: INSTANT IP replacement!`);
                    await this.ultraFastReplaceConnection(streamId);
                }
                
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
            logger.error(`❌ Stream #${streamId}: Error (${responseTime}ms): ${error.message}`);
        }
    }

    // Ультра-быстрая замена IP
    async ultraFastReplaceConnection(streamId) {
        logger.info(`⚡ Ultra-fast IP replacement for stream #${streamId}...`);
        
        try {
            const oldConnection = this.connectionPool.getConnectionForStream(streamId);
            if (oldConnection) {
                // Мгновенная блокировка IP
                await this.truthSocialAPI.addToBlackList(oldConnection.proxy, 'instant_block');
                logger.info(`⚡ Instant-blocked IP: ${oldConnection.proxy.split('@')[0]}@***`);
            }
            
            // Быстрый поиск замены
            const bestProxy = this.truthSocialAPI.getBestProxy();
            if (bestProxy) {
                const newAgent = this.truthSocialAPI.createProxyAgent(bestProxy);
                
                // Мгновенная замена
                this.connectionPool.connections.set(streamId % this.connectionPool.connections.size, {
                    proxy: bestProxy,
                    agent: newAgent,
                    lastUsed: Date.now(),
                    successCount: 0,
                    errorCount: 0,
                    isHealthy: true
                });
                
                logger.info(`⚡ Stream #${streamId}: Ultra-fast replacement → ${bestProxy.split('@')[0]}@***`);
                
                if (global.io) {
                    global.io.emit('log', {
                        level: 'success',
                        message: `⚡ Stream #${streamId}: Ultra-fast IP switch completed`
                    });
                }
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            logger.error(`❌ Ultra-fast replacement failed for stream #${streamId}: ${error.message}`);
            return false;
        }
    }

    // Поиск дополнительных рабочих прокси
    async findMoreWorkingProxies(needed) {
        logger.info(`🔍 Searching for ${needed} more working proxies...`);
        
        // Начальный лог в веб
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🔍 Searching ${needed} replacement IP for blocked streams...`
            });
        }
        
        const allProxies = this.truthSocialAPI.allProxies;
        const whiteList = this.truthSocialAPI.whiteList;
        const blackList = this.truthSocialAPI.blackList;
        
        const untestedProxies = allProxies.filter(proxy => 
            !whiteList.has(proxy) && !blackList.has(proxy)
        );
        
        let found = 0;
        const maxTests = Math.min(needed * 5, untestedProxies.length, 10);
        
        for (let i = 0; i < maxTests && found < needed; i++) {
            const proxy = untestedProxies[i];
            
            try {
                const agent = this.truthSocialAPI.createProxyAgent(proxy);
                const testUrl = 'https://truthsocial.com/api/v1/instance';
                
                const startTime = Date.now();
                
                const response = await Promise.race([
                    this.truthSocialAPI.makeRequest(testUrl, {
                        timeout: 3000, // Ускорили до 3 секунд
                        agent: agent
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Test timeout')), 3000)
                    )
                ]);
                
                const testTime = Date.now() - startTime;
                
                if (response.success) {
                    await this.truthSocialAPI.addToWhiteList(proxy, 'replacement_search');
                    logger.info(`✅ Found replacement proxy: ${proxy.split('@')[0]}@*** (${testTime}ms)`);
                    found++;
                } else {
                    await this.truthSocialAPI.addToBlackList(proxy, 'replacement_test_failed');
                }
                
            } catch (error) {
                await this.truthSocialAPI.addToBlackList(proxy, 'replacement_test_error');
            }
            
            await new Promise(resolve => setTimeout(resolve, 500)); // Ускорили паузу
        }
        
        logger.info(`🎯 Found ${found} replacement working proxies`);
        return found;
    }

    // НОВАЯ ФУНКЦИЯ: Статистика мгновенного обнаружения
    getInstantDetectionStats() {
        const recentDetections = this.detectionHistory.filter(d => 
            Date.now() - d.detectedAt < 60000 // Последние 60 секунд
        );
        
        return {
            turboMode: this.turboMode,
            streamCount: this.streamCount,
            effectiveSpeed: Math.round(this.streamInterval / this.streamCount), // ms между проверками
            recentDetections: recentDetections.length,
            detectionHistory: this.detectionHistory.slice(-5) // Последние 5 обнаружений
        };
    }

    // Остановка всех потоков
    stopParallelMonitoring() {
        if (!this.isRunning) {
            return { success: false, error: 'Not running' };
        }

        logger.info(`🛑 Stopping ${this.streams.size} TURBO monitoring streams...`);

        // Останавливаем все потоки
        for (const [streamId, intervalId] of this.streams) {
            clearInterval(intervalId);
            logger.info(`⏹️ TURBO Stream #${streamId} stopped`);
        }

        this.streams.clear();
        this.lastPostIds.clear();
        
        // Очищаем глобальное состояние
        this.globalLastPostIds.clear();
        this.postUpdateLock.clear();
        this.detectionHistory.clear();
        
        this.isRunning = false;

        logger.info(`✅ All TURBO monitoring streams stopped + global state cleared`);

        return {
            success: true,
            message: 'All TURBO streams stopped',
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
            totalRequestsPerMinute: this.isRunning ? Math.round((60000 / this.streamInterval) * this.streamCount * this.profiles.length) : 0,
            turboMode: this.turboMode,
            instantDetection: this.getInstantDetectionStats()
        };
    }

    // Изменение настроек потоков
    updateSettings(newStreamCount = null, newInterval = null) {
        if (newStreamCount && newStreamCount !== this.streamCount) {
            this.streamCount = newStreamCount;
            logger.info(`🔧 Updated TURBO stream count to: ${this.streamCount}`);
        }

        if (newInterval && newInterval !== this.streamInterval) {
            this.streamInterval = newInterval;
            logger.info(`🔧 Updated TURBO stream interval to: ${this.streamInterval}ms`);
        }

        return this.getStats();
    }
}

module.exports = ParallelMonitor;