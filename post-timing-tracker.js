// post-timing-tracker.js - Отслеживание времени между постами
const logger = require('./logger');

class PostTimingTracker {
    constructor() {
        this.lastPostTimes = new Map(); // username -> timestamp последнего поста
        this.postIntervals = new Map(); // username -> массив интервалов между постами
    }

    // Отслеживание времени между постами
    trackPostTiming(username, postContent) {
        const now = Date.now();
        const lastTime = this.lastPostTimes.get(username);
        
        if (lastTime) {
            const interval = now - lastTime;
            
            // Сохраняем интервал
            if (!this.postIntervals.has(username)) {
                this.postIntervals.set(username, []);
            }
            
            const intervals = this.postIntervals.get(username);
            intervals.push(interval);
            
            // Оставляем только последние 10 интервалов
            if (intervals.length > 10) {
                intervals.shift();
            }
            
            // Вычисляем статистику
            const avgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
            const minInterval = Math.min(...intervals);
            const maxInterval = Math.max(...intervals);
            
            const realSeconds = Math.round(interval / 1000);
            const avgSeconds = Math.round(avgInterval / 1000);
            
            logger.info(`⏰ [POST TIMING] @${username}: ${realSeconds}s since last post | Avg: ${avgSeconds}s | Min: ${Math.round(minInterval/1000)}s | Max: ${Math.round(maxInterval/1000)}s`);
            
            // Отправляем статистику в веб-интерфейс
            if (global.io) {
                global.io.emit('post-timing', {
                    username: username,
                    currentInterval: interval,
                    avgInterval: avgInterval,
                    minInterval: minInterval,
                    maxInterval: maxInterval,
                    totalPosts: intervals.length + 1,
                    intervals: intervals,
                    realSeconds: realSeconds,
                    avgSeconds: avgSeconds
                });
                
                global.io.emit('log', {
                    level: 'info',
                    message: `⏰ @${username} real timing: ${realSeconds}s interval (avg: ${avgSeconds}s)`
                });
            }
            
            // Обновляем время последнего поста
            this.lastPostTimes.set(username, now);
            
            return {
                interval: interval,
                avgInterval: avgInterval,
                minInterval: minInterval,
                maxInterval: maxInterval,
                realSeconds: realSeconds,
                avgSeconds: avgSeconds
            };
        } else {
            logger.info(`🎯 [FIRST POST] @${username}: Starting accurate timing tracking`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `🎯 @${username}: First post detected - accurate timing started`
                });
            }
            
            // Устанавливаем время первого поста
            this.lastPostTimes.set(username, now);
            return null;
        }
    }

    // Получение статистики времени для всех профилей
    getPostTimingStats() {
        const stats = {};
        
        for (const [username, intervals] of this.postIntervals) {
            if (intervals.length > 0) {
                const avgInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
                const minInterval = Math.min(...intervals);
                const maxInterval = Math.max(...intervals);
                
                stats[username] = {
                    totalPosts: intervals.length + 1,
                    avgInterval: avgInterval,
                    minInterval: minInterval,
                    maxInterval: maxInterval,
                    lastPostTime: this.lastPostTimes.get(username),
                    intervals: intervals
                };
            }
        }
        
        return stats;
    }

    // Получение точного времени из логов
    getAccuratePostTiming(username) {
        // Получаем все сохраненные посты для этого пользователя
        const userPosts = [];
        
        // Ищем в массиве recentPosts (если доступен через global)
        if (global.recentPosts) {
            const posts = global.recentPosts.filter(post => post.username === username);
            posts.forEach(post => {
                userPosts.push({
                    timestamp: new Date(post.timestamp).getTime(),
                    content: post.content.substring(0, 50)
                });
            });
        }
        
        // Сортируем по времени (новые сначала)
        userPosts.sort((a, b) => b.timestamp - a.timestamp);
        
        if (userPosts.length >= 2) {
            // Вычисляем реальные интервалы между постами
            const intervals = [];
            
            for (let i = 0; i < userPosts.length - 1; i++) {
                const interval = userPosts[i].timestamp - userPosts[i + 1].timestamp;
                intervals.push(interval);
            }
            
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const minInterval = Math.min(...intervals);
            const maxInterval = Math.max(...intervals);
            
            logger.info(`📊 [ACCURATE TIMING] @${username}: Last ${intervals.length} intervals - Avg: ${Math.round(avgInterval/1000)}s | Min: ${Math.round(minInterval/1000)}s | Max: ${Math.round(maxInterval/1000)}s`);
            
            return {
                intervals: intervals,
                avgInterval: avgInterval,
                minInterval: minInterval,
                maxInterval: maxInterval,
                totalPosts: userPosts.length,
                accuracy: 'from_logs'
            };
        }
        
        return null;
    }
}

module.exports = PostTimingTracker;