// script.js - API Version
const socket = io();

// DOM элементы
const startMonitoringBtn = document.getElementById('start-monitoring-btn');
const stopMonitoringBtn = document.getElementById('stop-monitoring-btn');
const testTruthSocialBtn = document.getElementById('test-truth-social-btn');
const addProfileBtn = document.getElementById('add-profile-btn');
const clearPostsBtn = document.getElementById('clear-posts-btn');
const clearLogsBtn = document.getElementById('clear-logs-btn');

// Элементы управления браузером
const openBrowserBtn = document.getElementById('open-browser-btn');
const closeBrowserBtn = document.getElementById('close-browser-btn');
const confirmAuthBtn = document.getElementById('confirm-auth-btn');

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

socket.on('gapUpdate', (data) => {
    updateGapStats(data.gapTime);
});

socket.on('profilesCount', (count) => {
    updateProfilesCount(count);
});

// === EVENT LISTENERS ===

if (openBrowserBtn) {
    openBrowserBtn.addEventListener('click', openBrowserForAuth);
}

if (closeBrowserBtn) {
    closeBrowserBtn.addEventListener('click', closeBrowserAuth);
}

if (confirmAuthBtn) {
    confirmAuthBtn.addEventListener('click', confirmAuthorization);
}

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
// Добавление токена в пул (вместо setAuthToken)
async function setAuthToken() {
    const token = authTokenInput.value.trim();
    
    if (!token) {
        alert('Please enter a Bearer token');
        return;
    }
    
    
    authTokenBtn.disabled = true;
    authTokenBtn.textContent = 'Adding to pool...';
    
    try {
        addLogToUI({ 
            level: 'info', 
            message: `🎫 Adding token to pool: ${token.substring(0, 20)}...` 
        });
        
        // Добавляем токен в пул через новый API
        const response = await fetch('/api/tokens/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: token })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Обновляем статус авторизации
            authStatusText.textContent = 'Token Pool Ready';
            authStatusText.className = 'status running';
            
            authTokenBtn.textContent = '✅ Added to Pool';
            authTokenBtn.className = 'btn btn-success';
            
            // Очищаем поле токена
            authTokenInput.value = '';
            
            addLogToUI({ 
                level: 'success', 
                message: `✅ Token added to pool successfully` 
            });
            
            // Обновляем список токенов
            updateTokensList();
            
        } else {
            authStatusText.textContent = 'Add Failed';
            authStatusText.className = 'status stopped';
            authTokenBtn.textContent = result.message.includes('exists') ? '⚠️ Already Exists' : '❌ Failed';
            authTokenBtn.className = result.message.includes('exists') ? 'btn btn-warning' : 'btn btn-danger';
            
            addLogToUI({ 
                level: result.message.includes('exists') ? 'warning' : 'error', 
                message: `${result.message.includes('exists') ? '⚠️' : '❌'} ${result.message}` 
            });
        }
        
    } catch (error) {
        authStatusText.textContent = 'Add Error';
        authStatusText.className = 'status stopped';
        authTokenBtn.textContent = '❌ Error';
        authTokenBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Error adding token: ${error.message}` 
        });
    }
    
    // Возвращаем кнопку в исходное состояние через 3 секунды
    setTimeout(() => {
        authTokenBtn.disabled = false;
        authTokenBtn.textContent = 'Add to Pool';
        authTokenBtn.className = 'btn btn-primary';
    }, 3000);
}

// Проверка статуса авторизации при загрузке
// Проверка статуса авторизации (ОБНОВЛЕННАЯ)
async function checkAuthStatus() {
    try {
        // Обновляем список токенов вместо старой логики
        await updateTokensList();
        
        // Проверяем есть ли токены в системе
        const response = await fetch('/api/tokens');
        const result = await response.json();
        
        if (result.success && result.data.tokens.length > 0) {
            const authStatusText = document.getElementById('auth-status-text');
            if (authStatusText) {
                authStatusText.textContent = `Token Pool (${result.data.tokens.length})`;
                authStatusText.className = 'status running';
            }
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
// Статистика Gap времени
let gapStats = {
    gaps: [],
    bestGap: Infinity,
    worstGap: 0,
    averageGap: 0
};
// Обновление Gap статистики
function updateGapStats(gapTime) {
    console.log(`🔧 Frontend received gap: ${gapTime}ms`);
    
    // Игнорируем нулевые и отрицательные значения
    if (gapTime > 0) {
        gapStats.gaps.push(gapTime);
    }
    
    // Оставляем только последние 100 измерений
    if (gapStats.gaps.length > 100) {
        gapStats.gaps = gapStats.gaps.slice(-100);
    }
    
    // Проверяем что есть данные для расчета
    if (gapStats.gaps.length === 0) {
        return; // Нет данных для статистики
    }
    
    // Вычисляем статистику только для положительных значений
    gapStats.bestGap = Math.min(...gapStats.gaps);
    gapStats.worstGap = Math.max(...gapStats.gaps);
    gapStats.averageGap = Math.round(gapStats.gaps.reduce((a, b) => a + b, 0) / gapStats.gaps.length);
    
    console.log(`🔧 Gap stats: best=${gapStats.bestGap}, worst=${gapStats.worstGap}, avg=${gapStats.averageGap}`);
    
    // Обновляем UI
    const bestGapElement = document.getElementById('best-gap');
    const worstGapElement = document.getElementById('worst-gap');
    const averageGapElement = document.getElementById('average-gap');
    
    if (bestGapElement) {
        bestGapElement.textContent = `${gapStats.bestGap}ms`;
    }
    
    if (worstGapElement) {
        worstGapElement.textContent = `${gapStats.worstGap}ms`;
    }
    
    if (averageGapElement) {
        averageGapElement.textContent = `${gapStats.averageGap}ms`;
    }
}

// Обновление количества профилей
function updateProfilesCount(count) {
    const profilesCountElement = document.getElementById('profiles-count');
    
    if (profilesCountElement) {
        profilesCountElement.textContent = count;
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

// === ФУНКЦИИ УПРАВЛЕНИЯ БРАУЗЕРОМ ===

// Открытие браузера для авторизации
async function openBrowserForAuth() {
    openBrowserBtn.disabled = true;
    openBrowserBtn.textContent = 'Opening...';
    
    try {
        addLogToUI({ 
            level: 'info', 
            message: '🌐 Opening browser for authorization...' 
        });
        
        const response = await fetch('/api/auth/start-browser', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        const result = await response.json();
        
        if (result.success) {
            openBrowserBtn.textContent = '✅ Browser Opened';
            openBrowserBtn.className = 'btn btn-success';
            closeBrowserBtn.disabled = false;
            
            // Если нужна верификация Cloudflare - активируем кнопку смены IP
            if (result.needsVerification) {
                tryNextIpBtn.disabled = false;
                tryNextIpBtn.textContent = 'Try Next IP';
                tryNextIpBtn.className = 'btn btn-warning';
                
                addLogToUI({ 
                    level: 'warning', 
                    message: '🛡️ Cloudflare verification required. Complete manually or try next IP.' 
                });
            } else {
                // Если все ОК - активируем кнопку подтверждения
                confirmAuthBtn.disabled = false;
                addLogToUI({ 
                    level: 'success', 
                    message: '✅ Browser opened successfully. Please login manually.' 
                });
            }
            
        } else {
            openBrowserBtn.textContent = '❌ Failed';
            openBrowserBtn.className = 'btn btn-danger';
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ Failed to open browser: ${result.error}` 
            });
            
            // Возвращаем кнопку в исходное состояние через 3 секунды
            setTimeout(() => {
                openBrowserBtn.disabled = false;
                openBrowserBtn.textContent = 'Open Browser';
                openBrowserBtn.className = 'btn btn-info';
            }, 3000);
        }
        
    } catch (error) {
        openBrowserBtn.textContent = '❌ Error';
        openBrowserBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Browser error: ${error.message}` 
        });
        
        setTimeout(() => {
            openBrowserBtn.disabled = false;
            openBrowserBtn.textContent = 'Open Browser';
            openBrowserBtn.className = 'btn btn-info';
        }, 3000);
    }
}

// Закрытие браузера
async function closeBrowserAuth() {
    closeBrowserBtn.disabled = true;
    closeBrowserBtn.textContent = 'Closing...';
    
    try {
        const response = await fetch('/api/auth/close-browser', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            resetBrowserButtons();
            addLogToUI({ 
                level: 'info', 
                message: '🔒 Browser closed' 
            });
        }
        
    } catch (error) {
        addLogToUI({ 
            level: 'error', 
            message: `❌ Error closing browser: ${error.message}` 
        });
        
        closeBrowserBtn.disabled = false;
        closeBrowserBtn.textContent = 'Close Browser';
    }
}

// Подтверждение авторизации
// Подтверждение авторизации
async function confirmAuthorization() {
    confirmAuthBtn.disabled = true;
    confirmAuthBtn.textContent = 'Extracting Token...';
    
    try {
        addLogToUI({ 
            level: 'info', 
            message: '🔍 Extracting authorization token...' 
        });
        
        const response = await fetch('/api/auth/extract-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Вставляем токен в поле
            authTokenInput.value = result.token;
            
            // АВТОМАТИЧЕСКИ сохраняем токен (токен уже сохранен на сервере!)
            authStatusText.textContent = 'Authorized';
            authStatusText.className = 'status running';
            authTokenBtn.textContent = '✅ Token Active';
            authTokenBtn.className = 'btn btn-success';
            
            // Сбрасываем кнопки браузера
            resetBrowserButtons();
            
            addLogToUI({ 
                level: 'success', 
                message: '✅ Token extracted and set successfully!' 
            });
            
            confirmAuthBtn.textContent = '✅ Token Set';
            confirmAuthBtn.className = 'btn btn-success';
            
        } else {
            confirmAuthBtn.textContent = '❌ Failed';
            confirmAuthBtn.className = 'btn btn-danger';
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ Token extraction failed: ${result.error}` 
            });
            
            // Возвращаем кнопку в исходное состояние через 3 секунды
            setTimeout(() => {
                confirmAuthBtn.disabled = false;
                confirmAuthBtn.textContent = 'I\'m Authorized';
                confirmAuthBtn.className = 'btn btn-success';
            }, 3000);
        }
        
    } catch (error) {
        confirmAuthBtn.textContent = '❌ Error';
        confirmAuthBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Token extraction error: ${error.message}` 
        });
        
        setTimeout(() => {
            confirmAuthBtn.disabled = false;
            confirmAuthBtn.textContent = 'I\'m Authorized';
            confirmAuthBtn.className = 'btn btn-success';
        }, 3000);
    }
}

// Сброс состояния кнопок браузера
function resetBrowserButtons() {
    openBrowserBtn.disabled = false;
    openBrowserBtn.textContent = 'Open Browser';
    openBrowserBtn.className = 'btn btn-info';
    
    closeBrowserBtn.disabled = true;
    closeBrowserBtn.textContent = 'Close Browser';
    closeBrowserBtn.className = 'btn btn-danger';
    
    confirmAuthBtn.disabled = true;
    confirmAuthBtn.textContent = 'I\'m Authorized';
    confirmAuthBtn.className = 'btn btn-success';
}

// Обновление отображения токена
function updateTokenDisplay(token) {
    const tokenDisplay = document.getElementById('auth-token-display');
    const tokenText = document.getElementById('current-token-text');
    const copyBtn = document.getElementById('copy-token-btn');
    
    // Проверяем существование элементов
    if (!tokenDisplay) {
        console.warn('Element auth-token-display not found');
        return;
    }
    
    if (token && tokenText && copyBtn) {
        tokenText.textContent = token.substring(0, 20) + '...';
        tokenDisplay.style.display = 'flex';
        
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(token);
            copyBtn.textContent = '✅ Copied';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        };
    } else {
        tokenDisplay.style.display = 'none';
    }
}

// Обновление списка токенов (С КНОПКОЙ УДАЛЕНИЯ)
async function updateTokensList() {
    try {
        const response = await fetch('/api/tokens');
        const result = await response.json();
        
        const tokensList = document.getElementById('tokens-list');
        const tokenDisplay = document.getElementById('auth-token-display');
        
        if (result.success && result.data.tokens.length > 0) {
            tokenDisplay.style.display = 'block';
            
            tokensList.innerHTML = result.data.tokens.map((tokenInfo, index) => {
                const statusClass = tokenInfo.available ? 'available' : 'cooldown';
                const statusText = tokenInfo.available ? 'Available' : 'Cooldown';
                
                return `
                    <div class="token-item">
                        <span class="token-text">${tokenInfo.token}</span>
                        <span class="token-stats">Requests: ${tokenInfo.requests} | Errors: ${tokenInfo.errors}</span>
                        <span class="token-status ${statusClass}">${statusText}</span>
                        <button onclick="removeToken(${index})" class="btn btn-danger btn-sm">🗑️</button>
                    </div>
                `;
            }).join('');
            
        } else {
            tokenDisplay.style.display = 'none';
        }
        
    } catch (error) {
        console.error('Error updating tokens list:', error);
    }
}

// Функция удаления токена
async function removeToken(index) {
    if (!confirm('Remove this token from pool?')) return;
    
    try {
        const response = await fetch(`/api/tokens/${index}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        if (result.success) {
            addLogToUI({ 
                level: 'info', 
                message: '🗑️ Token removed from pool' 
            });
            updateTokensList();
        } else {
            addLogToUI({ 
                level: 'error', 
                message: `❌ Failed to remove token: ${result.error}` 
            });
        }
    } catch (error) {
        addLogToUI({ 
            level: 'error', 
            message: `❌ Error removing token: ${error.message}` 
        });
    }
}

// Добавление нового токена
async function addNewToken() {
    const token = prompt('Enter new Bearer token:');
    if (token && token.trim()) {
        try {
            const response = await fetch('/api/tokens/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: token.trim() })
            });
            
            const result = await response.json();
            if (result.success) {
                addLogToUI({ 
                    level: 'success', 
                    message: '✅ Token added successfully' 
                });
                updateTokensList();
            } else {
                addLogToUI({ 
                    level: 'error', 
                    message: `❌ Failed to add token: ${result.error}` 
                });
            }
        } catch (error) {
            addLogToUI({ 
                level: 'error', 
                message: `❌ Error adding token: ${error.message}` 
            });
        }
    }
}

// Загружаем данные при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    loadProfiles();
    checkAuthStatus(); // Проверяем статус авторизации

    
    // Обновляем список токенов каждые 30 секунд
    updateTokensList();
    setInterval(updateTokensList, 30000);
    
    addLogToUI({ 
        level: 'info', 
        message: '🚀 Truth Social Parser API interface loaded' 
    });
});