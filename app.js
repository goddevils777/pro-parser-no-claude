const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

let parserStats = {
    isRunning: false,
    totalPosts: 0,
    errors: 0,
    profiles: [],
    lastPosts: []
};

// Загружаем логи и статистику из файлов
let webLogs = [];
let parseTimeStats = { min: Infinity, max: 0, total: 0, count: 0, average: 0 };
let recentPosts = []; 
let firstRequestSkipped = new Map();

// Загрузка данных при старте
async function loadPersistedData() {
    try {
        webLogs = await fs.readJson('./data/web-logs.json').catch(() => []);
        parseTimeStats = await fs.readJson('./data/parse-stats.json').catch(() => ({ 
            min: Infinity, max: 0, total: 0, count: 0, average: 0 
        }));
        recentPosts = await fs.readJson('./data/recent-posts.json').catch(() => []);
        
        console.log(`Loaded ${webLogs.length} logs, ${recentPosts.length} posts`);
        
    } catch (error) {
        console.log('No persisted data found, starting fresh');
    }
}

// Сохранение данных
async function savePersistedData() {
    try {
        await fs.writeJson('./data/web-logs.json', webLogs);
        await fs.writeJson('./data/parse-stats.json', parseTimeStats);
        await fs.writeJson('./data/recent-posts.json', recentPosts);
    } catch (error) {
        console.error('Failed to save data:', error);
    }
}

// Вызываем загрузку при старте
loadPersistedData();

// Главная страница
app.get('/', (req, res) => {
    res.render('index', { stats: parserStats });
});

// API endpoints
app.get('/api/profiles', async (req, res) => {
    try {
        const profiles = await fs.readJson('./data/profiles.json');
        res.json(profiles);
    } catch (error) {
        res.json([]);
    }
});

app.post('/api/profiles', async (req, res) => {
    try {
        const profiles = await fs.readJson('./data/profiles.json');
        profiles.push(req.body);
        await fs.writeJson('./data/profiles.json', profiles);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.delete('/api/profiles/:index', async (req, res) => {
    try {
        const profiles = await fs.readJson('./data/profiles.json');
        profiles.splice(req.params.index, 1);
        await fs.writeJson('./data/profiles.json', profiles);
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Запуск парсера
app.post('/api/parser/start', async (req, res) => {
    try {
        // Принудительно останавливаем старый парсер если есть
        if (global.parserInstance) {
            await global.parserInstance.stopMonitoring();
        }
        
        if (!global.parserInstance) {
            const StealthParser = require('./stealth-parser');
            global.parserInstance = new StealthParser();
            await global.parserInstance.init();
            global.io = io;
        }
        
        const profiles = await fs.readJson('./data/profiles.json').catch(() => []);
        
        if (profiles.length === 0) {
            return res.json({ success: false, error: 'No profiles to monitor' });
        }
        
        // ПРОВЕРЯЕМ ОБЩЕЕ КОЛИЧЕСТВО АККАУНТОВ (любого статуса)
        const allAccounts = global.parserInstance.getAccountsList();
        const requiredAccounts = profiles.length * 7; // 7 аккаунтов на профиль
        
        if (allAccounts.length < requiredAccounts) {
            const errorMessage = `❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles. Currently have: ${allAccounts.length} total accounts. Add ${requiredAccounts - allAccounts.length} more accounts before starting monitoring.`;
            
            return res.json({ success: false, error: errorMessage });
        }
        
        // Запускаем мониторинг
        await global.parserInstance.startMonitoring(profiles);
        
        parserStats.isRunning = true;
        parserStats.startTime = Date.now();
        
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Остановка парсера
app.post('/api/parser/stop', async (req, res) => {
    try {
        if (global.parserInstance) {
            await global.parserInstance.stopMonitoring();
            parserStats.isRunning = false;
            
            // Отправляем обновленный статус клиентам
            io.emit('stats', parserStats);
            io.emit('log', {
                level: 'info',
                message: 'Parser stopped (authorized browsers remain open)'
            });
        }
        res.json({ success: true });
        
    } catch (error) {
        console.error('Stop error:', error);
        res.json({ success: false, error: error.message });
    }
});


// Тестирование прокси
app.post('/api/proxy/test', async (req, res) => {
    let browser = null;
    
    try {
        if (!global.parserInstance) {
            const StealthParser = require('./stealth-parser');
            global.parserInstance = new StealthParser();
            await global.parserInstance.init();
            global.io = io;
        }
        
        // Получаем случайный прокси
        const proxyUrl = global.parserInstance.proxyManager.getNextProxy();
        if (!proxyUrl) {
            return res.json({ success: false, error: 'No proxies available' });
        }
        
        const proxy = global.parserInstance.proxyManager.parseProxy(proxyUrl);
        const proxyServer = proxy ? proxy.server : 'direct';
        
        console.log(`🧪 Testing proxy: ${proxyServer}`);
        
        // Запускаем браузер для теста
        const { chromium } = require('playwright');
        const startTime = Date.now();
        
        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            proxy: proxy
        });
        
        const page = await context.newPage();
        
        // Тестируем загрузку Google
        await page.goto('https://www.google.com/', { 
            waitUntil: 'domcontentloaded',
            timeout: 10000 
        });
        
        const loadTime = Date.now() - startTime;
        
        // Проверяем что страница загрузилась успешно
        const title = await page.title();
        const isLoaded = title.includes('Google');
        
        // ЗАКРЫВАЕМ БРАУЗЕР СРАЗУ
        await browser.close();
        browser = null;
        
        if (isLoaded) {
            // Добавляем прокси в whitelist
            await global.parserInstance.proxyManager.addWhitelistedProxy(proxyUrl);
            console.log(`✅ Proxy test successful: ${proxyServer} in ${loadTime}ms`);
        }
        
        res.json({
            success: isLoaded,
            proxy: proxyServer,
            loadTime: loadTime,
            title: title,
            error: isLoaded ? null : 'Page did not load correctly'
        });
        
    } catch (error) {
        console.error('❌ Proxy test error:', error);
        
        // Закрываем браузер в случае ошибки
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                // Игнорируем ошибки закрытия
            }
        }
        
        res.json({ success: false, error: error.message });
    }
});

// === API ДЛЯ УПРАВЛЕНИЯ АККАУНТАМИ ===

// Получение списка аккаунтов
app.get('/api/accounts', (req, res) => {
    console.log('🔍 API /api/accounts called');
    console.log('🔍 global.parserInstance exists:', !!global.parserInstance);
    
    if (global.parserInstance) {
        console.log('🔍 Calling getAccountsList...');
        const accounts = global.parserInstance.getAccountsList();
        console.log(`🔍 getAccountsList returned ${accounts.length} accounts:`, accounts);
        res.json(accounts);
    } else {
        console.log('🔍 No global.parserInstance found, returning empty array');
        res.json([]);
    }
});

// Начало авторизации аккаунта
app.post('/api/accounts/authorize', async (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.json({ success: false, error: 'Username required' });
    }
    
    try {
        if (!global.parserInstance) {
            const StealthParser = require('./stealth-parser');
            global.parserInstance = new StealthParser();
            await global.parserInstance.init();
            global.io = io;
        }
        
        const result = await global.parserInstance.startAccountAuthorization(username);
        res.json(result);
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Подтверждение авторизации аккаунта
app.post('/api/accounts/confirm', async (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.json({ success: false, error: 'Username required' });
    }
    
    try {
        if (!global.parserInstance) {
            return res.json({ success: false, error: 'Parser not initialized' });
        }
        
        const result = await global.parserInstance.confirmAccountAuthorization(username);
        res.json(result);
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Удаление аккаунта
app.delete('/api/accounts/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        if (global.parserInstance) {
            await global.parserInstance.removeAccount(username);
        }
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Статистика времени постов
app.get('/api/timing-stats', (req, res) => {
    if (global.parserInstance) {
        const timingStats = global.parserInstance.getPostTimingStats();
        res.json(timingStats);
    } else {
        res.json({});
    }
});

// Статистика вкладок
app.get('/api/tabs-stats', (req, res) => {
    if (global.parserInstance) {
        const tabsStats = global.parserInstance.getTabsStats();
        res.json(tabsStats);
    } else {
        res.json({});
    }
});

// === API ДЛЯ УПРАВЛЕНИЯ СЕССИЯМИ ===

// Проверка наличия сохраненной сессии
app.get('/api/sessions/check/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const sessionPath = `./data/sessions/${username}-session.json`;
        const hasSession = await fs.pathExists(sessionPath);
        
        if (hasSession) {
            const sessionData = await fs.readJson(sessionPath);
            res.json({
                hasSession: true,
                savedAt: new Date(sessionData.savedAt).toLocaleDateString(),
                cookiesCount: sessionData.cookies?.length || 0
            });
        } else {
            res.json({ hasSession: false });
        }
    } catch (error) {
        res.json({ hasSession: false, error: error.message });
    }
});

// Тестирование сессии (открыть браузер на 10 секунд)
app.post('/api/sessions/test/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        const sessionPath = `./data/sessions/${username}-session.json`;
        
        if (!await fs.pathExists(sessionPath)) {
            return res.json({ success: false, error: 'No saved session found' });
        }
        
        const sessionData = await fs.readJson(sessionPath);
        
        // Получаем рабочий IP через global.parserInstance
        let proxy = null;
        if (global.parserInstance && global.parserInstance.proxyManager) {
            const proxyUrl = global.parserInstance.proxyManager.getNextProxy();
            proxy = proxyUrl ? global.parserInstance.proxyManager.parseProxy(proxyUrl) : null;
        }
        
        console.log(`🧪 Testing session for ${username} with IP: ${proxy?.server || 'direct'}`);
        
        // Запускаем браузер для теста
        const { chromium } = require('playwright');
        const browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: sessionData.userAgent,
            viewport: { width: 1280, height: 720 },
            proxy: proxy
        });
        
        // Восстанавливаем cookies
        await context.addCookies(sessionData.cookies);
        
        const page = await context.newPage();
        
        // Восстанавливаем localStorage и sessionStorage
        await page.addInitScript(`
            localStorage.clear();
            sessionStorage.clear();
            Object.assign(localStorage, ${sessionData.localStorage});
            Object.assign(sessionStorage, ${sessionData.sessionStorage});
        `);
        
        // Переходим на сайт
        await page.goto('https://truthsocial.com/', { 
            waitUntil: 'domcontentloaded',
            timeout: 15000 
        });
        
        // Ждем 3 секунды загрузки
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Проверяем авторизацию
        const authCheck = await page.evaluate(() => {
            const bodyText = document.body.textContent;
            return {
                isLoggedIn: !bodyText.includes('Sign in') && 
                           !bodyText.includes('Log in') &&
                           !bodyText.includes('Create account'),
                title: document.title,
                url: window.location.href
            };
        });
        
        console.log(`🔍 Session test result for ${username}: ${authCheck.isLoggedIn ? 'VALID' : 'INVALID'}`);
        
        // Показываем результат на 7 секунд
        await new Promise(resolve => setTimeout(resolve, 7000));
        
        // Закрываем браузер
        await browser.close();
        
        res.json({
            success: true,
            isValid: authCheck.isLoggedIn,
            details: authCheck
        });
        
    } catch (error) {
        console.error(`❌ Session test error for ${username}:`, error);
        res.json({ success: false, error: error.message });
    }
});

// === WEBSOCKET ОБРАБОТКА ===

io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.emit('stats', parserStats);
    socket.emit('parse-stats', parseTimeStats);
    
    // Отправляем сохраненные логи при подключении
    console.log(`Sending ${webLogs.length} saved logs to client`);
    webLogs.forEach(log => {
        socket.emit('log', log);
    });

    // Отправляем сохраненные посты при подключении
    console.log(`Sending ${recentPosts.length} saved posts to client`);
    
    if (recentPosts.length > 0) {
        // Сортируем посты: новые сначала (по убыванию времени)
        const sortedPosts = [...recentPosts].sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime();
            const timeB = new Date(b.timestamp).getTime();
            return timeB - timeA; // Новые сначала
        });
        
        console.log(`Sorted posts: newest first - ${sortedPosts[0]?.timestamp}, oldest last - ${sortedPosts[sortedPosts.length-1]?.timestamp}`);
        
        socket.emit('saved-posts', sortedPosts);
    }
    
    socket.on('clear-logs', () => {
        webLogs = [];
        parseTimeStats = { min: Infinity, max: 0, total: 0, count: 0, average: 0 };
        recentPosts = [];
        io.emit('logs-cleared');
        io.emit('parse-stats', parseTimeStats);
        savePersistedData();
    });
    
    socket.on('clear-posts', () => {
        console.log('Clearing recent posts...');
        recentPosts = [];
        savePersistedData();
        io.emit('posts-cleared');
        console.log('Recent posts cleared');
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Функция для отправки обновлений клиентам
global.sendStatsUpdate = (data) => {
    Object.assign(parserStats, data);
    io.emit('stats', parserStats);
};

// Новая функция для обработки логов
global.sendLogUpdate = (logData) => {
    // Сохраняем лог
    webLogs.push({
        ...logData,
        timestamp: new Date().toLocaleTimeString()
    });
    
    // Ограничиваем количество логов (последние 500)
    if (webLogs.length > 500) {
        webLogs = webLogs.slice(-500);
    }
    
    // Анализируем время парсинга из сообщения
    const timeMatch = logData.message.match(/(\d+)ms\)$/);
    if (timeMatch && (logData.message.includes('No new posts') || logData.message.includes('FOUND POST'))) {
        const parseTime = parseInt(timeMatch[1]);
        
        // Извлекаем username из сообщения
        const usernameMatch = logData.message.match(/@(\w+):/);
        const username = usernameMatch ? usernameMatch[1] : null;
        
        // Пропускаем первый запрос для каждого пользователя
        if (username && !firstRequestSkipped.get(username)) {
            firstRequestSkipped.set(username, true);
            console.log(`Skipping first request for @${username}: ${parseTime}ms`);
            return;
        }
        
        parseTimeStats.min = Math.min(parseTimeStats.min, parseTime);
        parseTimeStats.max = Math.max(parseTimeStats.max, parseTime);
        parseTimeStats.total += parseTime;
        parseTimeStats.count++;
        parseTimeStats.average = Math.round(parseTimeStats.total / parseTimeStats.count);
        
        io.emit('parse-stats', parseTimeStats);
    }
    
    // Отправляем лог клиентам
    io.emit('log', logData);
    savePersistedData();
}; 

// Перехватываем отправку постов для сохранения
const originalEmit = io.emit;
io.emit = function(event, data) {
    if (event === 'new-post') {
        console.log('Saving new post:', data.username, data.content.substring(0, 50));
        
        // Сохраняем пост
        recentPosts.unshift(data);
        if (recentPosts.length > 100) {
            recentPosts = recentPosts.slice(0, 100);
        }
        
        // Обновляем статистику
        parserStats.totalPosts = (parserStats.totalPosts || 0) + 1;
        
        savePersistedData();
    }
    
    return originalEmit.call(this, event, data);
};

// === ЗАПУСК СЕРВЕРА ===
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`Web interface running on http://localhost:${PORT}`);
    
    // Инициализация парсера при старте сервера
    console.log('🔍 Initializing parser at server startup...');
    try {
        const StealthParser = require('./stealth-parser');
        global.parserInstance = new StealthParser();
        await global.parserInstance.init();
        global.io = io;
        console.log('✅ Parser initialized at startup');
    } catch (error) {
        console.error('❌ Failed to initialize parser:', error);
    }
});