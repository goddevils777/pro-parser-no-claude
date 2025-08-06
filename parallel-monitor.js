// parallel-monitor.js - Менеджер параллельных потоков мониторинга
const logger = require('./logger');

class ParallelMonitor {
    constructor(truthSocialAPI, postCallback) {
        this.truthSocialAPI = truthSocialAPI;
        this.postCallback = postCallback;
        this.streams = new Map(); // streamId -> intervalId
        this.lastPostIds = new Map(); // username -> lastPostId для каждого потока
        this.isRunning = false;
        this.profiles = [];
        
        // Настройки параллельных потоков
        this.streamCount = 5; // Количество потоков
        this.streamInterval = 15000; // 15 секунд между запросами в каждом потоке
        this.startDelay = 3000; // 3 секунды задержка между запуском потоков
    }

    // Запуск параллельного мониторинга
    async startParallelMonitoring(profiles) {
        if (this.isRunning) {
            logger.warn('⚠️ Parallel monitoring already running');
            return { success: false, error: 'Already running' };
        }

        this.profiles = profiles;
        this.isRunning = true;

        logger.info(`🚀 Starting ${this.streamCount} parallel monitoring streams...`);
        logger.info(`📊 Settings: ${this.streamCount} streams × ${this.streamInterval/1000}s interval = ~${this.streamInterval/this.streamCount/1000}s effective rate`);

        // Запускаем потоки с задержками
        for (let streamId = 0; streamId < this.streamCount; streamId++) {
            setTimeout(() => {
                this.startMonitoringStream(streamId);
            }, streamId * this.startDelay);
        }

        return {
            success: true,
            message: `Started ${this.streamCount} parallel streams`,
            streamCount: this.streamCount,
            interval: this.streamInterval,
            effectiveRate: Math.round(this.streamInterval / this.streamCount)
        };
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

    // Мониторинг профиля в конкретном потоке
    async monitorProfileInStream(username, streamId) {
        const streamKey = `${username}_stream${streamId}`;
        const startTime = Date.now();

        try {
            logger.info(`🔍 Stream #${streamId}: Checking @${username}...`);

            // Получаем последний пост
            const result = await this.truthSocialAPI.getUserPosts(username, 1);

            if (result.success && result.posts.length > 0) {
                const latestPost = result.posts[0];
                const lastPostId = this.lastPostIds.get(streamKey);

                // Проверяем, есть ли новый пост
                if (lastPostId !== latestPost.id) {
                    const responseTime = Date.now() - startTime;
                    
                    // Обновляем ID последнего поста для этого потока
                    this.lastPostIds.set(streamKey, latestPost.id);

                    logger.info(`🎯 Stream #${streamId}: NEW POST from @${username}! Response time: ${responseTime}ms`);
                    logger.info(`📝 Content: "${latestPost.content.substring(0, 100)}..."`);
                    logger.info(`⏰ Created: ${latestPost.createdAt}`);

                    // Отправляем уведомление
                    if (this.postCallback) {
                        this.postCallback({
                            profile: username,
                            post: latestPost,
                            foundAt: new Date().toISOString(),
                            streamId: streamId,
                            responseTime: responseTime,
                            method: result.method
                        });
                    }
                } else {
                    const responseTime = Date.now() - startTime;
                    logger.info(`✅ Stream #${streamId}: @${username} no new posts (${responseTime}ms)`);
                }
            } else {
                logger.warn(`⚠️ Stream #${streamId}: Failed to get posts for @${username}: ${result.error}`);
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