const socket = io();

// DOM элементы
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const addProfileBtn = document.getElementById('add-profile-btn');
const usernameInput = document.getElementById('username-input');
const keywordsInput = document.getElementById('keywords-input');
const profilesList = document.getElementById('profiles-list');
const parserStatus = document.getElementById('parser-status');
const totalPosts = document.getElementById('total-posts');
const totalErrors = document.getElementById('total-errors');
const profilesCount = document.getElementById('profiles-count');
const postsPerHour = document.getElementById('posts-per-hour');
const successRate = document.getElementById('success-rate');
const recentPosts = document.getElementById('recent-posts');
const logsContainer = document.getElementById('logs-container');

// WebSocket events
socket.on('stats', (stats) => {
    updateStats(stats);
});

socket.on('new-post', (post) => {
    addPostToUI(post);
});

socket.on('log', (log) => {
    addLogToUI(log);
});

// Event listeners
startBtn.addEventListener('click', startParser);
stopBtn.addEventListener('click', stopParser);
addProfileBtn.addEventListener('click', addProfile);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addProfile();
});

// Функции управления парсером
async function startParser() {
    try {
        // Сразу отключаем кнопку
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        
        const response = await fetch('/api/parser/start', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            addLogToUI({ level: 'success', message: 'Parser started successfully' });
        } else {
            // При ошибке возвращаем кнопку обратно
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
        }
    } catch (error) {
        // При ошибке возвращаем кнопку обратно
        startBtn.disabled = false;
        startBtn.textContent = 'Start Parser';
        addLogToUI({ level: 'error', message: 'Failed to start parser: ' + error.message });
    }
}

async function stopParser() {
    try {
        const response = await fetch('/api/parser/stop', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            addLogToUI({ level: 'info', message: 'Parser stopped' });
        }
    } catch (error) {
        addLogToUI({ level: 'error', message: 'Failed to stop parser: ' + error.message });
    }
}

// Функции работы с профилями
async function addProfile() {
    const username = usernameInput.value.trim();
    const keywords = keywordsInput.value.trim().split(',').map(k => k.trim()).filter(k => k);
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    try {
        const response = await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, keywords })
        });
        
        const result = await response.json();
        
        if (result.success) {
            usernameInput.value = '';
            keywordsInput.value = '';
            loadProfiles();
            addLogToUI({ level: 'success', message: `Profile @${username} added` });
        }
    } catch (error) {
        addLogToUI({ level: 'error', message: 'Failed to add profile: ' + error.message });
    }
}

async function deleteProfile(index) {
    try {
        const response = await fetch(`/api/profiles/${index}`, { method: 'DELETE' });
        const result = await response.json();
        
        if (result.success) {
            loadProfiles();
            addLogToUI({ level: 'info', message: 'Profile deleted' });
        }
    } catch (error) {
        addLogToUI({ level: 'error', message: 'Failed to delete profile: ' + error.message });
    }
}

async function loadProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const profiles = await response.json();
        
        profilesList.innerHTML = '';
        profilesCount.textContent = profiles.length;
        
        profiles.forEach((profile, index) => {
            const profileDiv = document.createElement('div');
            profileDiv.className = 'profile-item';
            profileDiv.innerHTML = `
                <div class="profile-info">
                    <div class="profile-username">@${profile.username}</div>
                    <div class="profile-keywords">
                        Keywords: ${profile.keywords.length > 0 ? profile.keywords.join(', ') : 'All posts'}
                    </div>
                </div>
                <button class="delete-btn" onclick="deleteProfile(${index})">Delete</button>
            `;
            profilesList.appendChild(profileDiv);
        });
    } catch (error) {
        addLogToUI({ level: 'error', message: 'Failed to load profiles: ' + error.message });
    }
}

// Функции обновления UI
function updateStats(stats) {
    parserStatus.textContent = stats.isRunning ? 'Running' : 'Stopped';
    parserStatus.className = `status ${stats.isRunning ? 'running' : 'stopped'}`;
    totalPosts.textContent = stats.totalPosts || 0;
    totalErrors.textContent = stats.errors || 0;
    
    // Управление кнопками
    if (stats.isRunning) {
        startBtn.disabled = true;
        startBtn.textContent = 'Parser Running';
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Parser';
        stopBtn.disabled = true;
    }
    
    // Остальные расчеты без изменений
    const postsPerHourValue = stats.totalPosts > 0 ? Math.round(stats.totalPosts * (3600000 / (Date.now() - (stats.startTime || Date.now())))) : 0;
    postsPerHour.textContent = postsPerHourValue;
    
    const total = (stats.totalPosts || 0) + (stats.errors || 0);
    const successRateValue = total > 0 ? Math.round(((stats.totalPosts || 0) / total) * 100) : 100;
    successRate.textContent = successRateValue + '%';
}

function addPostToUI(post) {
    const postDiv = document.createElement('div');
    postDiv.className = 'post-item';
    postDiv.innerHTML = `
        <div class="post-header">
            <span class="post-username">@${post.username}</span>
            <span class="post-time">${new Date(post.timestamp).toLocaleString()}</span>
        </div>
        <div class="post-content">${post.content}</div>
    `;
    
    recentPosts.insertBefore(postDiv, recentPosts.firstChild);
    
    // Ограничиваем количество постов в UI
    while (recentPosts.children.length > 50) {
        recentPosts.removeChild(recentPosts.lastChild);
    }
}

function addLogToUI(log) {
    const logDiv = document.createElement('div');
    logDiv.className = `log-item ${log.level}`;
    logDiv.textContent = `[${new Date().toLocaleTimeString()}] ${log.message}`;
    
    logsContainer.insertBefore(logDiv, logsContainer.firstChild);
    
    // Ограничиваем количество логов
    while (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
    
    // Автоскролл
    logsContainer.scrollTop = 0;
}

function updatePerformanceMetrics(data) {
    // Обновляем среднее время парсинга для каждого пользователя
    const avgTime = document.getElementById(`avg-time-${data.username}`) || createUserMetric(data.username);
    
    // Вычисляем среднее время (простой способ)
    const currentAvg = parseInt(avgTime.textContent) || 0;
    const newAvg = currentAvg === 0 ? data.parseTime : Math.round((currentAvg + data.parseTime) / 2);
    
    avgTime.textContent = `${newAvg}ms`;
    avgTime.className = newAvg < 1000 ? 'metric-good' : newAvg < 3000 ? 'metric-ok' : 'metric-slow';
}

function createUserMetric(username) {
    const recentPosts = document.getElementById('recent-posts');
    const metricDiv = document.createElement('div');
    metricDiv.innerHTML = `
        <div class="user-metric">
            <span>@${username} avg time:</span>
            <span id="avg-time-${username}" class="metric-value">0ms</span>
        </div>
    `;
    recentPosts.appendChild(metricDiv);
    return document.getElementById(`avg-time-${username}`);
}

// Принудительно обновляем статус при подключении
socket.on('connect', () => {
    addLogToUI({ level: 'info', message: 'Connected to server' });
});

socket.on('performance', (data) => {
    updatePerformanceMetrics(data);
});

// Инициализация
window.addEventListener('load', () => {
    loadProfiles();
    addLogToUI({ level: 'info', message: 'Web interface loaded' });
});

// Делаем функции глобальными для HTML onclick
window.deleteProfile = deleteProfile;


