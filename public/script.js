// script.js - API Version
const socket = io();

// DOM элементы
const startMonitoringBtn = document.getElementById('start-monitoring-btn');
const stopMonitoringBtn = document.getElementById('stop-monitoring-btn');
const testTruthSocialBtn = document.getElementById('test-truth-social-btn');
const addProfileBtn = document.getElementById('add-profile-btn');
const clearPostsBtn = document.getElementById('clear-posts-btn');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Элементы авторизации
const authTokenInput = document.getElementById('auth-token');
const authTokenBtn = document.getElementById('auth-token-btn');
const authStatusText = document.getElementById('auth-status-text');

const usernameInput = document.getElementById('username-input');
const keywordsInput = document.getElementById('keywords-input');
const profilesList = document.getElementById('profiles-list');
const recentPosts = document.getElementById('recent-posts');
const logsContainer = document.getElementById('logs-container');

// Статистика
let apiStats = {
    requests: 0,
    successCount: 0,
    errorCount: 0,
    lastCheck: null,
    responseTimes: []
};

let isMonitoring = false;
let monitoringInterval = null;

// === WEBSOCKET ОБРАБОТКА ===

socket.on('connect', () => {
    console.log('Connected to server');
    loadProfiles();
    addLogToUI({ level: 'success', message: '🔗 Connected to API server' });
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    addLogToUI({ level: 'warning', message: '❌ Disconnected from server' });
});

socket.on('stats', (stats) => {
    updateStats(stats);
});

socket.on('log', (logData) => {
    addLogToUI(logData);
});

socket.on('post', (postData) => {
    addPostToUI(postData);
});

socket.on('logs-cleared', () => {
    logsContainer.innerHTML = '';
});

socket.on('posts-cleared', () => {
    recentPosts.innerHTML = '';
});

// === EVENT LISTENERS ===

if (startMonitoringBtn) {
    startMonitoringBtn.addEventListener('click', startAPIMonitoring);
}

if (stopMonitoringBtn) {
    stopMonitoringBtn.addEventListener('click', stopAPIMonitoring);
}

if (testTruthSocialBtn) {
    testTruthSocialBtn.addEventListener('click', testTruthSocialConnection);
}

if (addProfileBtn) {
    addProfileBtn.addEventListener('click', addProfile);
}

if (clearPostsBtn) {
    clearPostsBtn.addEventListener('click', clearPosts);
}

if (authTokenBtn) {
    authTokenBtn.addEventListener('click', setAuthToken);
}

// === ФУНКЦИИ АВТОРИЗАЦИИ ===

// Установка Bearer токена
async function setAuthToken() {
    const token = authTokenInput.value.trim();
    
    if (!token) {
        alert('Please enter a Bearer token');
        return;
    }
    
    if (!token.startsWith('ey')) {
        alert('Invalid token format. Bearer tokens usually start with "ey"');
        return;
    }
    
    authTokenBtn.disabled = true;
    authTokenBtn.textContent = 'Setting token...';
    
    try {
        addLogToUI({ 
            level: 'info', 
            message: `🎫 Setting Bearer token...` 
        });
        
        const response = await fetch('/api/auth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        });
        
        const result = await response.json();
        
        if (result.success) {
            authStatusText.textContent = 'Authorized';
            authStatusText.className = 'status running';
            authTokenBtn.textContent = '✅ Token Set';
            authTokenBtn.className = 'btn btn-success';
            
            // Очищаем поле токена
            authTokenInput.value = '';
            
            addLogToUI({ 
                level: 'success', 
                message: `✅ Bearer token set successfully` 
            });
            
            if (result.warning) {
                addLogToUI({ 
                    level: 'warning', 
                    message: `⚠️ ${result.warning}` 
                });
            }
            
        } else {
            authStatusText.textContent = 'Token Invalid';
            authStatusText.className = 'status stopped';
            authTokenBtn.textContent = '❌ Invalid Token';
            authTokenBtn.className = 'btn btn-danger';
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ Token setup failed: ${result.error}` 
            });
            
            setTimeout(() => {
                authTokenBtn.disabled = false;
                authTokenBtn.textContent = 'Set Token';
                authTokenBtn.className = 'btn btn-primary';
            }, 3000);
        }
        
    } catch (error) {
        authStatusText.textContent = 'Setup Error';
        authStatusText.className = 'status stopped';
        authTokenBtn.textContent = '❌ Error';
        authTokenBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Token setup error: ${error.message}` 
        });
        
        setTimeout(() => {
            authTokenBtn.disabled = false;
            authTokenBtn.textContent = 'Set Token';
            authTokenBtn.className = 'btn btn-primary';
        }, 3000);
    }
}

// Проверка статуса авторизации при загрузке
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/status');
        const status = await response.json();
        
        if (status.isAuthorized) {
            authStatusText.textContent = 'Authorized';
            authStatusText.className = 'status running';
            authLoginBtn.textContent = '✅ Logged In';
            authLoginBtn.className = 'btn btn-success';
            authLoginBtn.disabled = true;
        }
        
    } catch (error) {
        console.error('Error checking auth status:', error);
    }
}

// Добавление профиля по Enter
if (usernameInput) {
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addProfile();
        }
    });
}

// === ОСНОВНЫЕ ФУНКЦИИ ===

// Запуск API мониторинга
async function startAPIMonitoring() {
    if (isMonitoring) return;
    
    try {
        const profiles = await loadProfiles();
        
        if (profiles.length === 0) {
            alert('Add at least one profile to monitor');
            return;
        }
        
        isMonitoring = true;
        startMonitoringBtn.disabled = true;
        stopMonitoringBtn.disabled = false;
        
        addLogToUI({ 
            level: 'info', 
            message: `🚀 Starting REAL monitoring for ${profiles.length} profiles` 
        });
        
        // Отправляем запрос на СЕРВЕР для запуска мониторинга
        const response = await fetch('/api/monitoring/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            addLogToUI({ 
                level: 'success', 
                message: `✅ ${result.message}` 
            });
        } else {
            addLogToUI({ 
                level: 'error', 
                message: `❌ Failed to start monitoring: ${result.error}` 
            });
            
            // Возвращаем кнопки в исходное состояние
            isMonitoring = false;
            startMonitoringBtn.disabled = false;
            stopMonitoringBtn.disabled = true;
        }
        
    } catch (error) {
        console.error('Error starting monitoring:', error);
        addLogToUI({ level: 'error', message: `❌ Failed to start monitoring: ${error.message}` });
        
        // Возвращаем кнопки в исходное состояние
        isMonitoring = false;
        startMonitoringBtn.disabled = false;
        stopMonitoringBtn.disabled = true;
    }
}

// Остановка мониторинга
async function stopAPIMonitoring() {
    if (!isMonitoring) return;
    
    try {
        const response = await fetch('/api/monitoring/stop', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            addLogToUI({ 
                level: 'info', 
                message: `⏹️ ${result.message}` 
            });
        }
        
    } catch (error) {
        addLogToUI({ level: 'error', message: `❌ Error stopping monitoring: ${error.message}` });
    }
    
    isMonitoring = false;
    startMonitoringBtn.disabled = false;
    stopMonitoringBtn.disabled = true;
}

// Убираем старые функции мониторинга из клиента - теперь все на сервере

// Мониторинг всех профилей - УДАЛЕНА (теперь на сервере)
// async function monitorAllProfiles(profiles) - УДАЛЕНА

// Мониторинг отдельного профиля - УДАЛЕНА (теперь на сервере)  
// async function monitorProfile(profile) - УДАЛЕНА

// Тест IP через Google
async function testTruthSocialConnection() {
    testTruthSocialBtn.disabled = true;
    testTruthSocialBtn.textContent = 'Testing IP...';
    
    try {
        addLogToUI({ 
            level: 'info', 
            message: `🧪 Testing IP connection through Google...` 
        });
        
        const response = await fetch('/api/test-truth-social', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        const result = await response.json();
        
        if (result.success) {
            testTruthSocialBtn.textContent = '✅ IP Working';
            testTruthSocialBtn.className = 'btn btn-success';
            
            addLogToUI({ 
                level: 'success', 
                message: `✅ ${result.message}` 
            });
            
            if (result.details) {
                addLogToUI({ 
                    level: 'info', 
                    message: `📊 Response time: ${result.details.responseTime}ms, Connection: ${result.details.proxy}` 
                });
            }
        } else {
            testTruthSocialBtn.textContent = '❌ IP Failed';
            testTruthSocialBtn.className = 'btn btn-danger';
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ ${result.error}` 
            });
            
            addLogToUI({ 
                level: 'warning', 
                message: `⚠️ Check your internet connection or proxy settings` 
            });
        }
        
        // Возвращаем кнопку в исходное состояние через 4 секунды
        setTimeout(() => {
            testTruthSocialBtn.disabled = false;
            testTruthSocialBtn.textContent = 'Test IP Connection';
            testTruthSocialBtn.className = 'btn btn-info';
        }, 4000);
        
    } catch (error) {
        testTruthSocialBtn.textContent = '❌ Network Error';
        testTruthSocialBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Network error: ${error.message}` 
        });
        
        setTimeout(() => {
            testTruthSocialBtn.disabled = false;
            testTruthSocialBtn.textContent = 'Test IP Connection';
            testTruthSocialBtn.className = 'btn btn-info';
        }, 4000);
    }
}

// === УПРАВЛЕНИЕ ПРОФИЛЯМИ ===

// Загрузка профилей
async function loadProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const profiles = await response.json();
        
        displayProfiles(profiles);
        updateProfilesCount(profiles.length);
        
        return profiles;
        
    } catch (error) {
        console.error('Failed to load profiles:', error);
        return [];
    }
}

// Отображение профилей
function displayProfiles(profiles) {
    if (!profilesList) return;
    
    profilesList.innerHTML = '';
    
    if (profiles.length === 0) {
        profilesList.innerHTML = '<div class="empty-state">No profiles added yet</div>';
        return;
    }
    
    profiles.forEach(profile => {
        const profileDiv = document.createElement('div');
        profileDiv.className = 'profile-item';
        
        profileDiv.innerHTML = `
            <div class="profile-info">
                <span class="profile-username">@${profile.username}</span>
                <span class="profile-keywords">${profile.keywords || 'All posts'}</span>
                <span class="profile-added">Added: ${new Date(profile.addedAt).toLocaleDateString()}</span>
            </div>
            <div class="profile-actions">
                <button onclick="deleteProfile('${profile.username}')" class="btn btn-danger btn-sm">Delete</button>
            </div>
        `;
        
        profilesList.appendChild(profileDiv);
    });
}

// Добавление профиля
async function addProfile() {
    const username = usernameInput.value.trim().replace('@', '');
    const keywords = keywordsInput.value.trim();
    
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    try {
        const response = await fetch('/api/profiles', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, keywords })
        });
        
        const result = await response.json();
        
        if (result.success) {
            usernameInput.value = '';
            keywordsInput.value = '';
            loadProfiles();
            addLogToUI({ level: 'success', message: `✅ Profile @${username} added successfully` });
        } else {
            alert(result.error);
        }
        
    } catch (error) {
        alert('Error adding profile: ' + error.message);
    }
}

// Удаление профиля
async function deleteProfile(username) {
    if (!confirm(`Delete profile @${username}?`)) return;
    
    try {
        const response = await fetch(`/api/profiles/${username}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadProfiles();
            addLogToUI({ level: 'info', message: `🗑️ Profile @${username} deleted` });
        } else {
            alert('Error deleting profile');
        }
        
    } catch (error) {
        alert('Error deleting profile: ' + error.message);
    }
}

// === UI ФУНКЦИИ ===

// Обновление статистики
function updateStats(stats) {
    const statusElement = document.getElementById('parser-status');
    const totalPostsElement = document.getElementById('total-posts');
    
    if (statusElement) {
        statusElement.textContent = isMonitoring ? 'Monitoring' : 'API Ready';
        statusElement.className = isMonitoring ? 'status running' : 'status stopped';
    }
    
    if (totalPostsElement) {
        totalPostsElement.textContent = stats.postsFound || 0;
    }
}

// Обновление API статистики
function updateAPIStats() {
    const requestsElement = document.getElementById('api-requests-count');
    const successRateElement = document.getElementById('success-rate');
    const lastCheckElement = document.getElementById('last-check-time');
    const responseTimeElement = document.getElementById('avg-response-time');
    
    if (requestsElement) {
        requestsElement.textContent = apiStats.requests;
    }
    
    if (successRateElement && apiStats.requests > 0) {
        const rate = Math.round((apiStats.successCount / apiStats.requests) * 100);
        successRateElement.textContent = `${rate}%`;
    }
    
    if (lastCheckElement && apiStats.lastCheck) {
        lastCheckElement.textContent = apiStats.lastCheck;
    }
    
    if (responseTimeElement && apiStats.responseTimes.length > 0) {
        const avgTime = Math.round(
            apiStats.responseTimes.reduce((a, b) => a + b, 0) / apiStats.responseTimes.length
        );
        responseTimeElement.textContent = `${avgTime}ms`;
    }
}

// Обновление количества профилей
function updateProfilesCount(count) {
    const profilesCountElement = document.getElementById('profiles-count');
    if (profilesCountElement) {
        profilesCountElement.textContent = count;
    }
}

// Добавление лога в UI
function addLogToUI(logData) {
    if (!logsContainer) return;
    
    const logDiv = document.createElement('div');
    logDiv.className = `log-entry log-${logData.level}`;
    
    const timestamp = logData.timestamp || new Date().toLocaleTimeString();
    
    logDiv.innerHTML = `
        <span class="log-time">${timestamp}</span>
        <span class="log-level">[${logData.level.toUpperCase()}]</span>
        <span class="log-message">${logData.message}</span>
    `;
    
    logsContainer.insertBefore(logDiv, logsContainer.firstChild);
    
    // Ограничиваем количество логов в UI
    while (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
}

// Добавление поста в UI
function addPostToUI(postData) {
    if (!recentPosts) return;
    
    const postDiv = document.createElement('div');
    postDiv.className = 'post-item';
    
    const foundTime = new Date(postData.foundAt).toLocaleString();
    
    postDiv.innerHTML = `
        <div class="post-header">
            <span class="post-author">@${postData.author}</span>
            <span class="post-time">${foundTime}</span>
        </div>
        <div class="post-content">${postData.content}</div>
        <div class="post-meta">
            <span class="post-source">Source: ${postData.source || 'API'}</span>
        </div>
    `;
    
    recentPosts.insertBefore(postDiv, recentPosts.firstChild);
    
    // Ограничиваем количество постов в UI
    while (recentPosts.children.length > 50) {
        recentPosts.removeChild(recentPosts.lastChild);
    }
}

// Очистка постов
function clearPosts() {
    if (confirm('Clear all recent posts?')) {
        socket.emit('clear-posts');
    }
}

// Очистка логов
function clearLogs() {
    socket.emit('clear-logs');
}

// === ИНИЦИАЛИЗАЦИЯ ===

// Загружаем данные при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();
    checkAuthStatus(); // Проверяем статус авторизации
    updateAPIStats();
    
    addLogToUI({ 
        level: 'info', 
        message: '🚀 Truth Social Parser API interface loaded' 
    });
});