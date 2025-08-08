// app-api.js - Truth Social Parser API Version
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const winston = require('winston');
const axios = require('axios');

// Подключаем классы
const TruthSocialAPI = require('./truth-social-api');
const BrowserManager = require('./browser-manager');

// Инициализация Truth Social API и BrowserManager
const truthSocialAPI = new TruthSocialAPI();
const browserManager = new BrowserManager(truthSocialAPI);


// Инициализация параллельного мониторинга
const ParallelMonitor = require('./parallel-monitor');
const StableConnectionPool = require('./stable-connection-pool');
let parallelMonitor = null;

// Инициализируем пул соединений
connectionPool = new StableConnectionPool(truthSocialAPI);

// Инициализируем параллельный мониторинг с callback
// Инициализируем параллельный мониторинг с callback и пулом соединений
parallelMonitor = new ParallelMonitor(truthSocialAPI, (postData) => {
    handleNewPost(postData);
}, connectionPool);



// Трекер времени между выдачами
let lastOutputTime = 0;

function getTimeSinceLastOutput() {
    const now = Date.now();
    const interval = lastOutputTime ? now - lastOutputTime : 0;
    lastOutputTime = now;
    return interval;
}
// Функция обработки всех результатов от потоков
function handleNewPost(postData) {
    const responseTime = postData.responseTime;
    const streamId = postData.streamId;
    const profile = postData.profile;
    const timeSinceLastOutput = getTimeSinceLastOutput();
    
    console.log(`🔧 DEBUG: Gap time: ${timeSinceLastOutput}ms`); // ← отладочный лог
    
    // Отправляем Gap статистику в веб
    io.emit('gapUpdate', { gapTime: timeSinceLastOutput });
    
    if (postData.type === 'new_post') {
        // Новый пост найден
        parserStats.postsFound++;
        
        const postEntry = {
            username: profile,
            content: postData.post.content,
            createdAt: postData.post.createdAt,
            foundAt: postData.foundAt,
            streamId: streamId,
            postId: postData.post.id,
            responseTime: responseTime
        };
        
        recentPosts.unshift(postEntry);
        
        if (recentPosts.length > 100) {
            recentPosts = recentPosts.slice(0, 100);
        }
        
        // Отправляем новый пост
        io.emit('post', {
            author: profile,
            content: postData.post.content,
            foundAt: postData.foundAt,
            streamId: streamId,
            responseTime: responseTime,
            source: `🎯 NEW POST - Stream #${streamId} (${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
        
        addLogToUI({
            level: 'success',
            message: `🎯 NEW POST @${profile} (Stream #${streamId}, ${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
        
    } else if (postData.type === 'check_result') {
        // Обычная проверка - показываем последний пост с пометкой
        io.emit('post', {
            author: profile,
            content: postData.post.content,
            foundAt: postData.foundAt,
            streamId: streamId,
            responseTime: responseTime,
            source: `✅ Last post - Stream #${streamId} (${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
        
        addLogToUI({
            level: 'info',
            message: `✅ Stream #${streamId}: @${profile} checked (${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
        
    } else if (postData.type === 'error') {
        // Ошибка при проверке
        io.emit('post', {
            author: profile,
            content: `❌ Error: ${postData.error}`,
            foundAt: postData.foundAt,
            streamId: streamId,
            responseTime: responseTime,
            source: `❌ Error - Stream #${streamId} (${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
        
        addLogToUI({
            level: 'error',
            message: `❌ Stream #${streamId}: @${profile} error (${responseTime}ms) | Gap: ${timeSinceLastOutput}ms`
        });
    }
    
    parserStats.lastActivity = new Date().toISOString();
}

// Инициализируем BrowserManager асинхронно
(async () => {
    try {
        await browserManager.init();
        logger.info('✅ BrowserManager initialized successfully');
    } catch (error) {
        logger.error('❌ BrowserManager initialization failed:', error.message);
    }
})();



const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Делаем io доступным глобально для других модулей
global.io = io;

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


// Функции для сохранения и загрузки токена
async function saveAuthToken(token) {
    try {
        await fs.ensureDir('./data');
        await fs.writeJson('./data/auth-token.json', {
            token: token,
            savedAt: new Date().toISOString()
        });
        logger.info('💾 Auth token saved to file');
    } catch (error) {
        logger.error(`Error saving auth token: ${error.message}`);
    }
}

async function loadAuthToken() {
    try {
        const tokenFile = './data/auth-token.json';
        if (await fs.pathExists(tokenFile)) {
            const tokenData = await fs.readJson(tokenFile);
            if (tokenData.token) {
                truthSocialAPI.authToken = tokenData.token;
                truthSocialAPI.isAuthorized = true;

                logger.info(`🎫 Auth token loaded from file: ${tokenData.token.substring(0, 20)}...`);
                addLogToUI({
                    level: 'success',
                    message: `🎫 Auth token loaded from previous session`
                });
                return true;
            }
        }
        return false;
    } catch (error) {
        logger.error(`Error loading auth token: ${error.message}`);
        return false;
    }
}

// Загружаем токен при старте
(async () => {
    await loadAuthToken();
})();


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




// Инициализация TokenManager (УБРАТЬ ОТСЮДА)
const TokenManager = require('./token-manager');
let tokenManager = null;

// Инициализируем TokenManager (УБРАТЬ ОТСЮДА)
(async () => {
    try {
        logger.info('🎫 Initializing TokenManager...');
        tokenManager = new TokenManager();
        await tokenManager.init();
        global.tokenManager = tokenManager;
        logger.info(`✅ TokenManager initialized successfully with ${tokenManager.tokens.length} tokens`);
    } catch (error) {
        logger.error('❌ TokenManager initialization failed:', error.message);
        logger.error('Stack trace:', error.stack);
    }
})();

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
        
if (token.length < 30) {
    return res.json({ success: false, error: 'Token too short (minimum 30 characters)' });
}
        
        logger.info(`🎫 Setting Bearer token: ${token.substring(0, 20)}...`);
        
        // Устанавливаем токен
        truthSocialAPI.authToken = token;
        truthSocialAPI.isAuthorized = true;
        await saveAuthToken(token);
        
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

// API для получения текущего токена
app.get('/api/auth/current-token', (req, res) => {
    if (truthSocialAPI.isAuthorized && truthSocialAPI.authToken) {
        res.json({
            success: true,
            token: truthSocialAPI.authToken,
            hasToken: true
        });
    } else {
        res.json({
            success: false,
            token: null,
            hasToken: false
        });
    }
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
// API для запуска параллельного мониторинга
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
        
        // Останавливаем старые интервалы если есть
        for (const [username, intervalId] of monitoringIntervals) {
            clearInterval(intervalId);
        }
        monitoringIntervals.clear();
        
        // Запускаем параллельный мониторинг
        const result = await parallelMonitor.startParallelMonitoring(profiles);
        
        if (result.success) {
            parserStats.running = true;
            parserStats.profilesCount = profiles.length;
            parserStats.lastActivity = new Date().toISOString();
            
            logger.info(`🚀 Started parallel monitoring: ${result.streamCount} streams`);
            addLogToUI({
                level: 'info',
                message: `🚀 Started ${result.streamCount} parallel streams for ${profiles.length} profiles`
            });
            
            updateStats({ running: true, profilesCount: profiles.length });
            // Отправляем начальную статистику профилей
io.emit('profilesCount', profiles.length);
        }
        
        res.json(result);
        
    } catch (error) {
        logger.error('Error starting parallel monitoring:', error);
        res.json({ success: false, error: error.message });
    }
});

// API для остановки параллельного мониторинга
app.post('/api/monitoring/stop', async (req, res) => {
    try {
        // Останавливаем параллельный мониторинг
        const result = parallelMonitor.stopParallelMonitoring();
        
        // Останавливаем старые интервалы если есть
        for (const [username, intervalId] of monitoringIntervals) {
            clearInterval(intervalId);
        }
        monitoringIntervals.clear();
        
        parserStats.running = false;
        parserStats.lastActivity = new Date().toISOString();
        
        if (result.success) {
            logger.info(`🛑 Stopped parallel monitoring: ${result.stoppedStreams} streams`);
            addLogToUI({
                level: 'info',
                message: `🛑 Stopped ${result.stoppedStreams} parallel streams`
            });
        }
        
        updateStats({ running: false });
        
        res.json(result);
        
    } catch (error) {
        logger.error('Error stopping parallel monitoring:', error);
        res.json({ success: false, error: error.message });
    }
});

// API для получения статистики параллельного мониторинга
app.get('/api/monitoring/stats', (req, res) => {
    try {
        const parallelStats = parallelMonitor.getStats();
        
        res.json({
            success: true,
            stats: {
                ...parserStats,
                parallel: parallelStats
            }
        });
        
    } catch (error) {
        logger.error('Error getting monitoring stats:', error);
        res.json({ success: false, error: error.message });
    }
});


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
        
        // Запускаем браузер с автоматической сменой IP (10 попытки)
        const result = await browserManager.startBrowser(10);
        
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


// API для извлечения токена из браузера (ИСПРАВЛЕНО)
app.post('/api/auth/extract-token', async (req, res) => {
    try {
        logger.info('🔍 Extracting token from browser...');
        const result = await browserManager.extractToken();
        
        if (result.success && result.token) {
            // ВАЖНО: Сохраняем токен в TruthSocialAPI
            truthSocialAPI.authToken = result.token;
            truthSocialAPI.isAuthorized = true;
            
            logger.info(`🎫 Token extracted and saved: ${result.token.substring(0, 20)}...`);
            
            // Тестируем токен
            try {
                const testResult = await truthSocialAPI.testConnection();
                if (testResult.success) {
                    logger.info(`✅ Token verified and working`);
                } else {
                    logger.warn(`⚠️ Token saved but verification failed: ${testResult.message}`);
                }
            } catch (testError) {
                logger.warn(`⚠️ Token saved but test failed: ${testError.message}`);
            }
            
            addLogToUI({
                level: 'success',
                message: `🎫 Token extracted and saved successfully: ${result.token.substring(0, 20)}...`
            });
            
            // Автоматически закрываем браузер
            try {
                await browserManager.closeBrowser();
                addLogToUI({
                    level: 'info',
                    message: '🔒 Browser closed automatically'
                });
            } catch (closeError) {
                logger.warn(`Warning closing browser: ${closeError.message}`);
            }
            
            res.json({ 
                success: true, 
                token: result.token,
                message: 'Token extracted and saved successfully',
                isAuthorized: true
            });
            
        } else {
            addLogToUI({
                level: 'warning',
                message: `⚠️ Token extraction failed: ${result.error}`
            });
            
            res.json({ 
                success: false, 
                error: result.error || 'Token extraction failed'
            });
        }
        
    } catch (error) {
        logger.error('Token extraction error:', error);
        addLogToUI({
            level: 'error',
            message: `❌ Token extraction error: ${error.message}`
        });
        res.json({ success: false, error: error.message });
    }
});


// API для получения списка токенов
app.get('/api/tokens', (req, res) => {
    try {
        if (global.tokenManager) {
            const stats = global.tokenManager.getStats();
            res.json({
                success: true,
                data: stats
            });
        } else {
            res.json({
                success: false,
                error: 'TokenManager not initialized'
            });
        }
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// API для добавления нового токена (С ОТЛАДКОЙ)
app.post('/api/tokens/add', async (req, res) => {
    try {
        const { token } = req.body;
        
        logger.info(`🎫 API /api/tokens/add called with token: ${token ? token.substring(0, 20) + '...' : 'null'}`);
        
        if (!token || token.length < 10) {
            logger.warn(`❌ Invalid token format: ${token}`);
            return res.json({
                success: false,
                error: 'Invalid token format'
            });
        }
        
        if (global.tokenManager) {
            logger.info(`✅ TokenManager found, adding token...`);
            const added = await global.tokenManager.addToken(token);
            
            logger.info(`🎫 Token add result: ${added}`);
            
            res.json({
                success: added,
                message: added ? 'Token added successfully' : 'Token already exists'
            });
        } else {
            logger.error(`❌ TokenManager not initialized`);
            res.json({
                success: false,
                error: 'TokenManager not initialized'
            });
        }
    } catch (error) {
        logger.error(`❌ Error in /api/tokens/add: ${error.message}`);
        res.json({
            success: false,
            error: error.message
        });
    }
});

// API для удаления токена
app.delete('/api/tokens/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        
        if (global.tokenManager) {
            const removed = await global.tokenManager.removeToken(index);
            res.json({
                success: removed,
                message: removed ? 'Token removed successfully' : 'Failed to remove token'
            });
        } else {
            res.json({
                success: false,
                error: 'TokenManager not initialized'
            });
        }
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
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