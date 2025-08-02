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

let parserInstance = null;
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
        
        // ОТЛАДКА
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
        await fs.writeJson('./data/recent-posts.json', recentPosts); // ДОБАВЬ ЭТУ СТРОКУ
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

// Замени app.post('/api/parser/start') на:
app.post('/api/parser/start', async (req, res) => {
    try {
        // Принудительно останавливаем старый парсер если есть
        if (parserInstance) {
            await parserInstance.stopMonitoring();
        }
        
        if (!parserInstance) {
            const StealthParser = require('./stealth-parser');
            parserInstance = new StealthParser();
            await parserInstance.init();
            global.io = io;
        }
        
        const profiles = await fs.readJson('./data/profiles.json').catch(() => []);
        
        if (profiles.length === 0) {
            return res.json({ success: false, error: 'No profiles to monitor' });
        }
        
        // Запускаем мониторинг
        await parserInstance.startMonitoring(profiles);
        
        parserStats.isRunning = true;
        parserStats.startTime = Date.now();
        
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/parser/stop', async (req, res) => {
    try {
        if (parserInstance) {
            await parserInstance.stopMonitoring();
            parserStats.isRunning = false; // ВАЖНО!
            
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

// === НОВЫЕ API ДЛЯ УПРАВЛЕНИЯ АККАУНТАМИ ===

// Получение списка аккаунтов
app.get('/api/accounts', (req, res) => {
    if (parserInstance) {
        const accounts = parserInstance.getAccountsList();
        res.json(accounts);
    } else {
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
        if (!parserInstance) {
            const StealthParser = require('./stealth-parser');
            parserInstance = new StealthParser();
            await parserInstance.init();
            global.io = io;
        }
        
        const result = await parserInstance.startAccountAuthorization(username);
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
        if (!parserInstance) {
            return res.json({ success: false, error: 'Parser not initialized' });
        }
        
        const result = await parserInstance.confirmAccountAuthorization(username);
        res.json(result);
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Удаление аккаунта
app.delete('/api/accounts/:username', async (req, res) => {
    const { username } = req.params;
    
    try {
        if (parserInstance) {
            await parserInstance.removeAccount(username);
        }
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Изменение логики запуска парсера
app.post('/api/parser/start', async (req, res) => {
    try {
        if (!parserInstance) {
            const StealthParser = require('./stealth-parser');
            parserInstance = new StealthParser();
            await parserInstance.init();
            global.io = io;
        }
        
        const profiles = await fs.readJson('./data/profiles.json').catch(() => []);
        
        if (profiles.length === 0) {
            return res.json({ success: false, error: 'No profiles to monitor' });
        }
        
        // Запускаем мониторинг
        await parserInstance.startMonitoring(profiles);
        
        parserStats.isRunning = true;
        parserStats.startTime = Date.now();
        
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Остановка парсера (не закрывает авторизованные браузеры)
app.post('/api/parser/stop', async (req, res) => {
    try {
        if (parserInstance) {
            await parserInstance.stopMonitoring();
            parserStats.isRunning = false;
        }
        res.json({ success: true });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// WebSocket для real-time обновлений
io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.emit('stats', parserStats);
    socket.emit('parse-stats', parseTimeStats);
    
// Отправляем сохраненные логи при подключении
console.log(`Sending ${webLogs.length} saved logs to client`); // ОТЛАДКА
webLogs.forEach(log => {
    socket.emit('log', log);
});

// Отправляем сохраненные посты при подключении  
console.log(`Sending ${recentPosts.length} saved posts to client`); // ОТЛАДКА
recentPosts.forEach(post => {
    socket.emit('new-post', post);
});
    
    socket.on('clear-logs', () => {
        webLogs = [];
        parseTimeStats = { min: Infinity, max: 0, total: 0, count: 0, average: 0 };
        io.emit('logs-cleared');
        io.emit('parse-stats', parseTimeStats);
        savePersistedData(); // ДОБАВИТЬ ЭТУ СТРОКУ
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
            return; // Не учитываем в статистике
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
        // Сохраняем пост
        recentPosts.unshift(data);
        if (recentPosts.length > 100) {
            recentPosts = recentPosts.slice(0, 100);
        }
        savePersistedData();
    }
    
    return originalEmit.call(this, event, data);
};



async function startMonitoring() {
    try {
        const profiles = await fs.readJson('./data/profiles.json').catch(() => []);
        
        if (profiles.length === 0) {
            io.emit('log', {
                level: 'warning',
                message: 'No profiles to monitor. Add profiles first.'
            });
            return;
        }
        
        
        parserStats.isRunning = true;
        io.emit('stats', parserStats);
        
        // Используем новую параллельную логику
        await parserInstance.startParallelParsing(profiles);
        
        io.emit('log', {
            level: 'success',
            message: `✅ All sessions created. Monitoring ${profiles.length} profiles every 0.5s`
        });
        
    } catch (error) {
        console.error('Monitoring error:', error);
        io.emit('log', {
            level: 'warning',
            message: 'Failed to start monitoring. Check console for details.'
        });
    }
}

function shouldNotify(post, keywords) {
    if (!keywords || keywords.length === 0) return true;
    
    const content = post.content.toLowerCase();
    return keywords.some(keyword => content.includes(keyword.toLowerCase()));
}



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Web interface running on http://localhost:${PORT}`);
});