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
    if (!parserInstance) {
        try {

            const StealthParser = require('./stealth-parser');

            // Делаем io глобальным для парсера
            global.io = io;
            global.totalPosts = 0;
            global.totalErrors = 0;
            
            parserInstance = new StealthParser();
            await parserInstance.init();
            
            parserStats.isRunning = true;
            parserStats.startTime = Date.now();
            
            // Запускаем мониторинг
            setTimeout(() => startMonitoring(), 1000);
            
            io.emit('log', {
                level: 'success',
                message: 'Parser started successfully'
            });
            
            res.json({ success: true });
        } catch (error) {
            console.error('Parser start error:', error);
            io.emit('log', {
                level: 'error',
                message: 'Failed to start parser: ' + error.message
            });
            res.json({ success: false, error: error.message });
        }
    } else {
        res.json({ success: false, error: 'Parser already running' });
    }
});

app.post('/api/parser/stop', async (req, res) => {
    if (parserInstance) {
        try {
            await parserInstance.stop();
            parserInstance = null;
            parserStats.isRunning = false;
            
            io.emit('log', {
                level: 'info',
                message: 'Parser stopped'
            });
            
            res.json({ success: true });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    } else {
        res.json({ success: false, error: 'Parser not running' });
    }
});

// WebSocket для real-time обновлений
io.on('connection', (socket) => {
    console.log('Client connected');
    
    socket.emit('stats', parserStats);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Функция для отправки обновлений клиентам
global.sendStatsUpdate = (data) => {
    Object.assign(parserStats, data);
    io.emit('stats', parserStats);
};

async function startMonitoring() {
    const checkInterval = 5000; // 5 секунд для демо
    
    while (parserStats.isRunning && parserInstance) {
        try {
            const profiles = await fs.readJson('./data/profiles.json').catch(() => []);
            
            for (const profile of profiles) {
                const post = await parserInstance.parseLatestPost(profile.username);
                
                if (post && shouldNotify(post, profile.keywords)) {
                    // Сохраняем пост и отправляем уведомления
                    // Логика уже встроена в parseLatestPost
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        } catch (error) {
            console.error('Monitoring error:', error);
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
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