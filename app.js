// app-api.js - Truth Social Parser API Version
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');
const axios = require('axios');

const truthSocialAPI = new TruthSocialAPI();
const browserManager = new BrowserManager(truthSocialAPI);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Глобальные переменные
let parserStats = {
    running: false,
    profilesCount: 0,
    accountsCount: 0,
    postsFound: 0,
    lastActivity: null
};

let parseTimeStats = {};
let webLogs = [];
let recentPosts = [];
let monitoringIntervals = new Map(); // username -> intervalId

// Инициализация Truth Social API
const truthSocialAPI = new TruthSocialAPI();
const browserManager = new BrowserManager();

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './logs/combined.log' })
    ]
});

// === API ENDPOINTS ===

// Главная страница
app.get('/', (req, res) => {
    res.render('index', { 
        title: 'Truth Social Parser - API Version',
        version: 'API'
    });
});

// API для получения профилей
app.get('/api/profiles', async (req, res) => {
    try {
        const profilesPath = './data/profiles.json';
        if (await fs.pathExists(profilesPath)) {
            const profiles = await fs.readJson(profilesPath);
            res.json(profiles);
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json([]);
    }
});

// API для добавления профиля
app.post('/api/profiles', async (req, res) => {
    try {
        const { username, keywords } = req.body;
        
        if (!username) {
            return res.json({ success: false, error: 'Username required' });
        }

        const profilesPath = './data/profiles.json';
        let profiles = [];
        
        if (await fs.pathExists(profilesPath)) {
            profiles = await fs.readJson(profilesPath);
        }

        // Проверяем дубликаты
        if (profiles.find(p => p.username === username)) {
            return res.json({ success: false, error: 'Profile already exists' });
        }

        profiles.push({
            username: username.replace('@', ''),
            keywords: keywords || '',
            addedAt: new Date().toISOString(),
            status: 'active'
        });

        await fs.ensureDir('./data');
        await fs.writeJson(profilesPath, profiles);
        
        logger.info(`📝 Profile added: @${username}`);
        res.json({ success: true, message: 'Profile added successfully' });
        
    } catch (error) {
        logger.error('Error adding profile:', error);
        res.json({ success: false, error: error.message });
    }
});

// API для удаления профиля
app.delete('/api/profiles/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const profilesPath = './data/profiles.json';
        
        if (await fs.pathExists(profilesPath)) {
            let profiles = await fs.readJson(profilesPath);
            profiles = profiles.filter(p => p.username !== username);
            await fs.writeJson(profilesPath, profiles);
        }
        
        logger.info(`🗑️ Profile removed: @${username}`);
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// API для получения аккаунтов (заглушка)
app.get('/api/accounts', (req, res) => {
    logger.info('🔍 API /api/accounts called - returning empty array (API mode)');
    res.json([]);
});

// API для получения постов
app.get('/api/posts', async (req, res) => {
    try {
        const postsPath = './data/recent-posts.json';
        if (await fs.pathExists(postsPath)) {
            const posts = await fs.readJson(postsPath);
            res.json(posts.slice(0, 50)); // Последние 50 постов
        } else {
            res.json([]);
        }
    } catch (error) {
        res.json([]);
    }
});

// API для получения логов
app.get('/api/logs', (req, res) => {
    res.json(webLogs.slice(-100)); // Последние 100 логов
});

// API для очистки логов
app.post('/api/logs/clear', (req, res) => {
    webLogs = [];
    logger.info('🗑️ Logs cleared');
    res.json({ success: true });
});

// API для очистки постов
app.post('/api/posts/clear', (req, res) => {
    recentPosts = [];
    logger.info('🗑️ Posts cleared');
    res.json({ success: true });
});

// API для статистики
app.get('/api/stats', (req, res) => {
    res.json({
        ...parserStats,
        version: 'API',
        mode: 'API-only (browsers disabled)'
    });
});

// API для установки Bearer токена
app.post('/api/auth/token', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.json({ success: false, error: 'Token required' });
        }
        
        if (!token.startsWith('ey')) {
            return res.json({ success: false, error: 'Invalid token format (should start with "ey")' });
        }
        
        logger.info(`🎫 Setting Bearer token: ${token.substring(0, 20)}...`);
        
        // Устанавливаем токен
        truthSocialAPI.authToken = token;
        truthSocialAPI.isAuthorized = true;
        
        // Тестируем токен
        const testResult = await truthSocialAPI.testConnection();
        
        if (testResult.success) {
            logger.info(`✅ Bearer token is valid and working`);
            addLogToUI({
                level: 'success',
                message: `✅ Bearer token set successfully and tested`
            });
            
            res.json({ 
                success: true, 
                message: 'Token set and verified successfully',
                isAuthorized: true,
                stats: testResult.stats
            });
        } else {
            logger.warn(`⚠️ Bearer token set but test failed: ${testResult.message}`);
            addLogToUI({
                level: 'warning',
                message: `⚠️ Token set but verification failed: ${testResult.message}`
            });
            
            res.json({ 
                success: true, 
                message: 'Token set (verification failed but will try to use)',
                isAuthorized: true,
                warning: testResult.message
            });
        }
        
    } catch (error) {
        logger.error('Token setup error:', error.message);
        res.json({ 
            success: false, 
            error: error.message 
        });
    }
});

// API для проверки статуса авторизации
app.get('/api/auth/status', (req, res) => {
    res.json({
        isAuthorized: truthSocialAPI.isAuthorized,
        hasToken: !!truthSocialAPI.authToken,
        stats: truthSocialAPI.getStats()
    });
});
app.post('/api/test-truth-social', async (req, res) => {
    try {
        logger.info(`🧪 Testing simple HTTP connection...`);
        
        // Простейший тест без прокси и SSL
        const startTime = Date.now();
        
        try {
            // Тестируем простой HTTP сайт
            const response = await axios.get('http://httpbin.org/ip', {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const responseTime = Date.now() - startTime;
            
            if (response.status === 200) {
                const ip = response.data.origin || 'unknown';
                logger.info(`✅ Connection test successful: IP ${ip}, ${responseTime}ms`);
                
                res.json({ 
                    success: true, 
                    message: `Connection working! Your IP: ${ip}`,
                    details: {
                        responseTime: responseTime,
                        ip: ip,
                        status: 'working'
                    }
                });
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
            
        } catch (httpError) {
            logger.warn(`HTTP test failed: ${httpError.message}`);
            
            // Fallback - простая проверка DNS
            const dns = require('dns');
            const dnsStartTime = Date.now();
            
            dns.lookup('google.com', (err, address) => {
                const dnsTime = Date.now() - dnsStartTime;
                
                if (!err) {
                    logger.info(`✅ DNS test successful: ${address}, ${dnsTime}ms`);
                    res.json({ 
                        success: true, 
                        message: `DNS working! Google resolves to ${address}`,
                        details: {
                            responseTime: dnsTime,
                            ip: address,
                            status: 'dns_only'
                        }
                    });
                } else {
                    logger.error(`❌ DNS test failed: ${err.message}`);
                    res.json({ 
                        success: false, 
                        error: `No internet connection: ${err.message}`,
                        details: {
                            status: 'failed'
                        }
                    });
                }
            });
        }
        
    } catch (error) {
        logger.error('Connection test error:', error.message);
        res.json({ 
            success: false, 
            error: `Connection test failed: ${error.message}`,
            details: {
                status: 'error'
            }
        });
    }
});

// API для запуска мониторинга
app.post('/api/monitoring/start', async (req, res) => {
    try {
        const profilesPath = './data/profiles.json';
        
        if (!(await fs.pathExists(profilesPath))) {
            return res.json({ success: false, error: 'No profiles to monitor' });
        }
        
        const profiles = await fs.readJson(profilesPath);
        
        if (profiles.length === 0) {
            return res.json({ success: false, error: 'No profiles to monitor' });
        }
        
        // Останавливаем существующие интервалы
        for (const [username, intervalId] of monitoringIntervals) {
            clearInterval(intervalId);
        }
        monitoringIntervals.clear();
        
        // Закрываем браузер если открыт
        if (browserManager && browserManager.isRunning) {
            logger.info('🔒 Closing browser...');
            await browserManager.closeBrowser();
        }
        
        // Запускаем РЕАЛЬНЫЙ мониторинг профилей
        const intervalId = setInterval(async () => {
            await monitorAllProfiles(profiles);
        }, 30000); // каждые 30 секунд
        
        monitoringIntervals.set('main', intervalId);
        
        // Первый запуск сразу
        await monitorAllProfiles(profiles);
        
        parserStats.running = true;
        parserStats.profilesCount = profiles.length;
        parserStats.lastActivity = new Date().toISOString();
        
        logger.info(`🚀 Started REAL API monitoring for ${profiles.length} profiles`);
        addLogToUI({
            level: 'info',
            message: `🚀 Started monitoring ${profiles.length} profiles: ${profiles.map(p => '@' + p.username).join(', ')}`
        });
        
        updateStats({ running: true, profilesCount: profiles.length });
        
        res.json({ 
            success: true, 
            message: `Monitoring started for ${profiles.length} profiles`,
            profiles: profiles.map(p => p.username)
        });
        
    } catch (error) {
        logger.error('Error starting monitoring:', error);
        res.json({ success: false, error: error.message });
    }
});

// Функция мониторинга всех профилей
async function monitorAllProfiles(profiles) {
    addLogToUI({ 
        level: 'info', 
        message: `🔄 Checking ${profiles.length} profiles for latest posts...` 
    });
    
    for (const profile of profiles) {
        try {
            const success = await monitorProfileWithRetry(profile);
            
            if (!success) {
                addLogToUI({
                    level: 'warning',
                    message: `⚠️ Failed to check @${profile.username} - trying next IP`
                });
            }
            
            // Задержка между профилями 
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (error) {
            addLogToUI({ 
                level: 'error', 
                message: `❌ Error checking @${profile.username}: ${error.message}` 
            });
        }
    }
}

// Мониторинг профиля с повторами и сменой IP
async function monitorProfileWithRetry(profile, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            addLogToUI({
                level: 'info',
                message: `🔍 Checking @${profile.username} (attempt ${attempt}/${maxRetries})...`
            });
            
            const startTime = Date.now();
            
            // Получаем последний пост через Truth Social API
            const result = await truthSocialAPI.getUserPosts(profile.username, 1);
            const responseTime = Date.now() - startTime;
            
            if (result.success && result.posts.length > 0) {
                const latestPost = result.posts[0];
                
                addLogToUI({
                    level: 'success',
                    message: `✅ @${profile.username} checked successfully (${responseTime}ms)`
                });
                
                // Показываем последний пост
                const postData = {
                    id: latestPost.id,
                    content: latestPost.content,
                    createdAt: latestPost.createdAt,
                    author: profile.username,
                    profile: profile.username,
                    keywords: profile.keywords,
                    foundAt: new Date().toISOString(),
                    method: result.method || 'api',
                    url: latestPost.url
                };
                
                addPostToUI(postData);
                await savePost(postData);
                
                parserStats.postsFound++;
                parserStats.lastActivity = new Date().toISOString();
                updateStats({ postsFound: parserStats.postsFound });
                
                // Показываем информацию о посте
                const postTime = new Date(latestPost.createdAt);
                const now = new Date();
                const diffMinutes = Math.round((now - postTime) / (1000 * 60));
                
                addLogToUI({
                    level: 'info',
                    message: `📄 Latest post from @${profile.username} (${diffMinutes} min ago): "${latestPost.content.substring(0, 100)}..."`
                });
                
                return true; // Успех
                
            } else if (result.error && result.error.includes('cloudflare')) {
                // Cloudflare заблокировал - пробуем следующий IP
                addLogToUI({
                    level: 'warning',
                    message: `🛡️ Cloudflare blocked IP for @${profile.username} - trying next IP...`
                });
                
                // Принудительно переключаем на следующий прокси
                truthSocialAPI.currentProxyIndex = (truthSocialAPI.currentProxyIndex + 1) % (truthSocialAPI.proxies.length || 1);
                
                continue; // Пробуем снова с новым IP
                
            } else {
                addLogToUI({
                    level: 'warning',
                    message: `⚠️ @${profile.username} no posts found: ${result.error || 'empty feed'} (${responseTime}ms)`
                });
                
                return false;
            }
            
        } catch (error) {
            addLogToUI({
                level: 'error',
                message: `❌ Attempt ${attempt} failed for @${profile.username}: ${error.message}`
            });
            
            if (attempt < maxRetries) {
                addLogToUI({
                    level: 'info',
                    message: `🔄 Switching IP and retrying @${profile.username}...`
                });
                
                // Переключаем на следующий прокси
                truthSocialAPI.currentProxyIndex = (truthSocialAPI.currentProxyIndex + 1) % (truthSocialAPI.proxies.length || 1);
                
                // Ждем перед повтором
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    
    return false; // Все попытки неудачны
}

// Сохранение поста в файл
async function savePost(postData) {
    try {
        const postsPath = './data/recent-posts.json';
        let posts = [];
        
        if (await fs.pathExists(postsPath)) {
            posts = await fs.readJson(postsPath);
        }
        
        posts.unshift(postData);
        
        // Ограничиваем количество сохраненных постов
        if (posts.length > 1000) {
            posts = posts.slice(0, 1000);
        }
        
        await fs.ensureDir('./data');
        await fs.writeJson(postsPath, posts);
        
    } catch (error) {
        logger.error('Error saving post:', error);
    }
}

// === WEBSOCKET ОБРАБОТКА ===

io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.emit('stats', parserStats);
    
    // Отправляем сохраненные логи при подключении
    console.log(`Sending ${webLogs.length} saved logs to client`);
    webLogs.forEach(log => {
        socket.emit('log', log);
    });

    // Отправляем сохраненные посты при подключении
    console.log(`Sending ${recentPosts.length} saved posts to client`);
    recentPosts.forEach(post => {
        socket.emit('post', post);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });

    // Очистка логов
    socket.on('clear-logs', () => {
        webLogs = [];
        io.emit('logs-cleared');
        logger.info('🗑️ Logs cleared by client');
    });

    // Очистка постов
    socket.on('clear-posts', () => {
        recentPosts = [];
        io.emit('posts-cleared');
        logger.info('🗑️ Posts cleared by client');
    });
});

// Функция для добавления лога
function addLogToUI(logData) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
        ...logData,
        timestamp: timestamp
    };
    
    webLogs.push(logEntry);
    
    // Ограничиваем количество логов в памяти
    if (webLogs.length > 500) {
        webLogs = webLogs.slice(-500);
    }
    
    // Отправляем лог всем подключенным клиентам
    io.emit('log', logEntry);
}

// Функция для добавления поста
function addPostToUI(postData) {
    const postEntry = {
        ...postData,
        foundAt: new Date().toISOString()
    };
    
    recentPosts.unshift(postEntry);
    
    // Ограничиваем количество постов в памяти
    if (recentPosts.length > 100) {
        recentPosts = recentPosts.slice(0, 100);
    }
    
    // Отправляем пост всем подключенным клиентам
    io.emit('post', postEntry);
}

// Функция обновления статистики
function updateStats(newStats) {
    parserStats = { ...parserStats, ...newStats };
    io.emit('stats', parserStats);
}

// API для запуска браузера авторизации
// API для запуска браузера авторизации
app.post('/api/auth/start-browser', async (req, res) => {
    try {
        logger.info('🌐 Starting browser authorization...');
        
        // Запускаем браузер с автоматической сменой IP (3 попытки)
        const result = await browserManager.startBrowser(3);
        
        if (result.success) {
            addLogToUI({
                level: 'info',
                message: '🌐 Browser opened for manual authorization'
            });
        } else {
            addLogToUI({
                level: 'error',
                message: `❌ Browser start failed: ${result.error}`
            });
        }
        
        res.json(result);
        
    } catch (error) {
        logger.error('Browser start error:', error);
        res.json({ success: false, error: error.message });
    }
});

// API для закрытия браузера
app.post('/api/auth/close-browser', async (req, res) => {
    try {
        await browserManager.closeBrowser();
        
        addLogToUI({
            level: 'info',
            message: '🔒 Browser closed'
        });
        
        res.json({ success: true, message: 'Browser closed' });
        
    } catch (error) {
        logger.error('Browser close error:', error);
        res.json({ success: false, error: error.message });
    }
});

// API для получения статуса браузера
app.get('/api/auth/browser-status', (req, res) => {
    const status = browserManager.getStatus();
    res.json(status);
});

// API для извлечения токена из браузера
app.post('/api/auth/extract-token', async (req, res) => {
    try {
        const result = await browserManager.extractToken();
        
        if (result.success) {
            // Автоматически устанавливаем токен в Truth Social API
            truthSocialAPI.authToken = result.token;
            truthSocialAPI.isAuthorized = true;
            
            addLogToUI({
                level: 'success',
                message: `🎫 Token extracted and set successfully: ${result.token.substring(0, 20)}...`
            });
            
            // Автоматически закрываем браузер
            await browserManager.closeBrowser();
            
            addLogToUI({
                level: 'info',
                message: '🔒 Browser closed automatically'
            });
            
        } else {
            addLogToUI({
                level: 'warning',
                message: `⚠️ Token extraction failed: ${result.error}`
            });
        }
        
        res.json(result);
        
    } catch (error) {
        logger.error('Token extraction error:', error);
        addLogToUI({
            level: 'error',
            message: `❌ Token extraction error: ${error.message}`
        });
        res.json({ success: false, error: error.message });
    }
});


// === ЗАПУСК СЕРВЕРА ===

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    logger.info(`🚀 Truth Social Parser API Server running on port ${PORT}`);
    logger.info(`📊 Dashboard: http://localhost:${PORT}`);
    logger.info(`⚡ Mode: API-only (browsers disabled)`);
    
    addLogToUI({
        level: 'info',
        message: `🚀 Server started in API mode on port ${PORT}`
    });
    
    updateStats({
        running: false,
        profilesCount: 0,
        accountsCount: 0,
        postsFound: 0,
        lastActivity: new Date().toISOString()
    });
});

// Graceful shutdown - исправленная версия
let isShuttingDown = false;

process.on('SIGINT', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    logger.info('🛑 Shutting down server...');
    
    // Останавливаем все интервалы мониторинга
    for (const [username, intervalId] of monitoringIntervals) {
        clearInterval(intervalId);
    }
    monitoringIntervals.clear();

    
    
    server.close(() => {
        logger.info('✅ Server closed');
        process.exit(0);
    });
    
    // Принудительно завершаем через 2 секунды
    setTimeout(() => {
        logger.info('🔪 Force closing server');
        process.exit(1);
    }, 2000);
});

module.exports = app;