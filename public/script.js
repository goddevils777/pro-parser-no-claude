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
const avgParseTime = document.getElementById('avg-parse-time');
const minParseTime = document.getElementById('min-parse-time');
const maxParseTime = document.getElementById('max-parse-time');
const clearLogsBtn = document.getElementById('clear-logs-btn');
const clearPostsBtn = document.getElementById('clear-posts-btn');
const profilesCountStatus = document.getElementById('profiles-count-status');
const authorizedCountStatus = document.getElementById('authorized-count-status');
const requiredCountStatus = document.getElementById('required-count-status');
const stillNeedStatus = document.getElementById('still-need-status');
const readinessStatus = document.getElementById('readiness-status');


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

socket.on('parse-stats', (stats) => {
    updateParseStats(stats);
});

socket.on('logs-cleared', () => {
    logsContainer.innerHTML = '';
});

// Event listeners
startBtn.addEventListener('click', startParser);
stopBtn.addEventListener('click', stopParser);
addProfileBtn.addEventListener('click', addProfile);
clearLogsBtn.addEventListener('click', clearLogs);
clearPostsBtn.addEventListener('click', clearPosts);
usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addProfile();
});

// Функции управления парсером
// Заменить функцию startParser в public/script.js
async function startParser() {
    try {
        console.log('Starting parser...'); // ОТЛАДКА
        
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        
        const response = await fetch('/api/parser/start', { method: 'POST' });
        const result = await response.json();
        
        console.log('Start result:', result); // ОТЛАДКА
        
        if (result.success) {
            addLogToUI({ level: 'success', message: 'Parser started successfully' });
        } else {
            console.error('Start failed:', result.error); // ОТЛАДКА
            
            // Показываем ошибку в логах вместо alert
            addLogToUI({ 
                level: 'error', 
                message: `❌ Failed to start parser: ${result.error}` 
            });
            
            // Если ошибка связана с аккаунтами, показываем дополнительную информацию
// Если ошибка связана с аккаунтами, показываем дополнительную информацию
            if (result.error.includes('INSUFFICIENT ACCOUNTS') || result.error.includes('Need') || result.error.includes('accounts')) {
                addLogToUI({ 
                    level: 'warning', 
                    message: '🧪 TEST MODE: Each profile needs exactly 3 authorized accounts for testing' 
                });
                
                addLogToUI({ 
                    level: 'info', 
                    message: '💡 Go to "Account Management" section to authorize more accounts' 
                });
                
                addLogToUI({ 
                    level: 'info', 
                    message: '🔄 Will be changed back to 10 accounts after testing is complete' 
                });
            }
            
            // Возвращаем кнопку в исходное состояние
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
        }
    } catch (error) {
        console.error('Start error:', error); // ОТЛАДКА
        
        startBtn.disabled = false;
        startBtn.textContent = 'Start Parser';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Failed to start parser: ${error.message}` 
        });
    }
}

async function stopParser() {
    try {
        console.log('Stopping parser...'); // ОТЛАДКА
        
        const response = await fetch('/api/parser/stop', { method: 'POST' });
        const result = await response.json();
        
        console.log('Stop result:', result); // ОТЛАДКА
        
        if (result.success) {
            addLogToUI({ level: 'info', message: 'Parser stopped' });
            
            // Принудительно обновляем кнопки
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
            stopBtn.disabled = true;
            
        } else {
            addLogToUI({ level: 'error', message: 'Failed to stop: ' + result.error });
        }
    } catch (error) {
        console.log('Stop error:', error); // ОТЛАДКА
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
    // Добавляем проверки на существование элементов
    if (parserStatus) parserStatus.textContent = stats.isRunning ? 'running' : 'stopped';
    if (totalPosts) totalPosts.textContent = stats.totalPosts || 0;
    if (totalErrors) totalErrors.textContent = stats.errors || 0;
    
    // Управление кнопками
    if (stats.isRunning) {
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Parser Running';
        }
        if (stopBtn) stopBtn.disabled = false;
    } else {
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
        }
        if (stopBtn) stopBtn.disabled = true;
    }
    
    // Остальные расчеты с проверками
    if (postsPerHour) {
        const postsPerHourValue = stats.totalPosts > 0 ? Math.round(stats.totalPosts * (3600000 / (Date.now() - (stats.startTime || Date.now())))) : 0;
        postsPerHour.textContent = postsPerHourValue;
    }
    
    if (successRate) {
        const total = (stats.totalPosts || 0) + (stats.errors || 0);
        const successRateValue = total > 0 ? Math.round(((stats.totalPosts || 0) / total) * 100) : 100;
        successRate.textContent = successRateValue + '%';
    }
}

// Заменить функцию addPostToUI в public/script.js (только для НОВЫХ постов)
function addPostToUI(post) {
    console.log('Adding NEW post to UI:', post.username, post.timestamp);
    
    if (!recentPosts) {
        console.error('recentPosts element not found');
        return;
    }
    
    const postElement = document.createElement('div');
    postElement.className = 'recent-post new-post'; // Класс для новых постов
    
    // Форматируем время
    const time = new Date(post.timestamp).toLocaleTimeString();
    const currentPostTime = new Date(post.timestamp).getTime();
    
    // Вычисляем РЕАЛЬНЫЙ интервал с предыдущим постом (ТОЛЬКО БОЛЕЕ СТАРЫЕ)
    const existingPosts = Array.from(recentPosts.children);
    let realInterval = null;
    
    if (existingPosts.length > 0) {
        // Ищем предыдущий пост от того же пользователя (ТОЛЬКО БОЛЕЕ СТАРЫЕ)
        for (let i = 0; i < existingPosts.length; i++) {
            const existingPost = existingPosts[i];
            const existingUsername = existingPost.querySelector('.post-username')?.textContent;
            
            if (existingUsername === `@${post.username}`) {
                // Нашли пост от этого пользователя
                const existingTimeStr = existingPost.querySelector('.post-time')?.dataset.timestamp;
                if (existingTimeStr) {
                    const existingTime = parseInt(existingTimeStr);
                    
                    // ВАЖНО: Берем только БОЛЕЕ СТАРЫЕ посты (existingTime < currentPostTime)
                    if (existingTime < currentPostTime) {
                        realInterval = Math.round((currentPostTime - existingTime) / 1000);
                        console.log(`Found older post: current=${currentPostTime}, existing=${existingTime}, interval=${realInterval}s`);
                        break;
                    } else {
                        console.log(`Skipping newer post: current=${currentPostTime}, existing=${existingTime}`);
                    }
                }
            }
        }
    }
    
    // Формируем строку с интервалом
    const timingInfo = realInterval !== null && realInterval > 0 ? 
        ` | Real interval: ${realInterval}s` : 
        ' | Latest post';
    
    postElement.innerHTML = `
        <div class="post-header">
            <span class="post-username">@${post.username}</span>
            <span class="post-time" data-timestamp="${currentPostTime}">${time} (${post.parseTime}ms)${timingInfo}</span>
            <span class="post-account">by ${post.parsedBy || 'unknown'}</span>
            ${post.tabId ? `<span class="post-tab">Tab #${post.tabId}</span>` : ''}
        </div>
        <div class="post-content">${post.content}</div>
        <div class="post-footer">
            <span class="post-ip">${post.accountIP || 'Direct'}</span>
            ${post.foundWith ? `<span class="post-selector">Found: ${post.foundWith}</span>` : ''}
            ${post.attempts ? `<span class="post-attempts">${post.attempts} attempts</span>` : ''}
            ${realInterval !== null && realInterval > 0 ? `<span class="post-real-interval">⏰ ${realInterval}s</span>` : ''}
            <span class="post-new">🔥 NEW</span>
        </div>
    `;
    
    // НОВЫЕ посты добавляем СВЕРХУ
    recentPosts.insertBefore(postElement, recentPosts.firstChild);
    
    // Ограничиваем количество отображаемых постов
    while (recentPosts.children.length > 50) {
        recentPosts.removeChild(recentPosts.lastChild);
    }
    
    // Обновляем счетчик постов
    const totalPostsElement = document.getElementById('total-posts');
    if (totalPostsElement) {
        const currentCount = parseInt(totalPostsElement.textContent) || 0;
        totalPostsElement.textContent = currentCount + 1;
    }
    
    // Анимация для новых постов
    postElement.style.opacity = '0';
    postElement.style.transform = 'translateY(-10px)';
    
    setTimeout(() => {
        postElement.style.transition = 'all 0.3s ease';
        postElement.style.opacity = '1';
        postElement.style.transform = 'translateY(0)';
    }, 100);
    
    console.log(`NEW post added: @${post.username}, realInterval: ${realInterval}s`);
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

function updateParseStats(stats) {
    avgParseTime.textContent = stats.average > 0 ? stats.average + 'ms' : '0ms';
    minParseTime.textContent = stats.min < Infinity ? stats.min + 'ms' : '0ms';
    maxParseTime.textContent = stats.max + 'ms';
}

// === УПРАВЛЕНИЕ АККАУНТАМИ ===
const addAccountBtn = document.getElementById('add-account-btn');
const accountUsernameInput = document.getElementById('account-username-input');
const accountsList = document.getElementById('accounts-list');

addAccountBtn.addEventListener('click', addAccount);
accountUsernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addAccount();
});

async function addAccount() {
    const username = accountUsernameInput.value.trim();
    
    if (!username) {
        alert('Please enter account username');
        return;
    }
    
    // Блокируем кнопку до завершения всего процесса авторизации
    addAccountBtn.disabled = true;
    addAccountBtn.textContent = 'Opening browser...';
    
    try {
        const response = await fetch('/api/accounts/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const result = await response.json();
        
        if (result.success) {
            accountUsernameInput.value = '';
            addAccountBtn.textContent = 'Waiting for authorization...';
            // НЕ разблокируем кнопку - ждем подтверждения
            loadAccounts();
        } else {
            alert('Failed to add account: ' + result.error);
            // Разблокируем только при ошибке
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        }
    } catch (error) {
        alert('Error: ' + error.message);
        // Разблокируем только при ошибке
        addAccountBtn.disabled = false;
        addAccountBtn.textContent = 'Add Account';
    }
}

// Подтверждение авторизации
async function confirmAuthorization(username) {
    try {
        const response = await fetch('/api/accounts/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadAccounts();
            // Разблокируем кнопку после успешного подтверждения
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        } else {
            alert('Failed to confirm: ' + result.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Удаление аккаунта
async function deleteAccount(username) {
    if (!confirm(`Delete account ${username}?`)) return;
    
    try {
        const response = await fetch(`/api/accounts/${username}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadAccounts();
            // Разблокируем кнопку если удалили аккаунт в процессе авторизации
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Загрузка списка аккаунтов
async function loadAccounts() {
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        
        accountsList.innerHTML = '';
        
        accounts.forEach(account => {
            const accountDiv = document.createElement('div');
            accountDiv.className = `account-item ${account.status}`;
            
            const statusIcon = account.status === 'authorized' ? '✅' : 
                             account.status === 'authorizing' ? '🔄' : '❌';
            
            accountDiv.innerHTML = `
                <div class="account-info">
                    <span class="account-status">${statusIcon}</span>
                    <span class="account-username">${account.username}</span>
                    <span class="account-ip">${account.ip || 'No IP'}</span>
                    <span class="account-cookies">${account.cookiesCount || 0} cookies</span>
                </div>
                <div class="account-actions">
                    ${account.status === 'authorizing' ? 
                        `<button onclick="confirmAuthorization('${account.username}')" class="btn btn-success btn-sm">I'm Authorized</button>` : ''}
                    <button onclick="deleteAccount('${account.username}')" class="btn btn-danger btn-sm">Delete</button>
                </div>
            `;
            
            accountsList.appendChild(accountDiv);
        });
        
    } catch (error) {
        console.error('Failed to load accounts:', error);
    }
}

function clearLogs() {
    socket.emit('clear-logs');
}

// Добавить новую функцию
function clearPosts() {
    if (confirm('Are you sure you want to clear all recent posts?')) {
        // Очищаем UI
        recentPosts.innerHTML = '';
        
        // Отправляем команду на сервер для очистки сохраненных постов
        socket.emit('clear-posts');
        
        // Добавляем лог
        addLogToUI({ 
            level: 'info', 
            message: '🗑️ Recent posts cleared' 
        });
        
        console.log('Posts cleared by user');
    }
}

// Добавить новую функцию для обновления статуса
function updateAccountStatus() {
    // Получаем количество профилей
    fetch('/api/profiles')
        .then(response => response.json())
        .then(profiles => {
            const profilesCount = profiles.length;
            
            // Получаем количество авторизованных аккаунтов
            fetch('/api/accounts')
                .then(response => response.json())
                .then(accounts => {
                    const authorizedCount = accounts.filter(acc => acc.status === 'authorized').length;
                    const requiredCount = profilesCount * 3; // 10 аккаунтов на профиль
                    const stillNeed = Math.max(0, requiredCount - authorizedCount);
                    
                    // Обновляем значения
                    if (profilesCountStatus) profilesCountStatus.textContent = profilesCount;
                    if (authorizedCountStatus) authorizedCountStatus.textContent = authorizedCount;
                    if (requiredCountStatus) requiredCountStatus.textContent = requiredCount;
                    if (stillNeedStatus) {
                        stillNeedStatus.textContent = stillNeed;
                        
                        // Меняем цвет в зависимости от количества
                        stillNeedStatus.className = 'status-value ' + 
                            (stillNeed === 0 ? 'status-success' : 'status-warning');
                    }
                    
                    // Обновляем статус готовности
                    if (readinessStatus) {
                        if (profilesCount === 0) {
                            readinessStatus.textContent = 'No Profiles';
                            readinessStatus.className = 'status-badge status-error';
                        } else if (stillNeed === 0) {
                            readinessStatus.textContent = 'Ready!';
                            readinessStatus.className = 'status-badge status-ready';
                        } else if (authorizedCount > 0) {
                            readinessStatus.textContent = `Need ${stillNeed} more`;
                            readinessStatus.className = 'status-badge status-partial';
                        } else {
                            readinessStatus.textContent = 'Not Ready';
                            readinessStatus.className = 'status-badge status-error';
                        }
                    }
                    
                    console.log(`Status: ${profilesCount} profiles, ${authorizedCount}/${requiredCount} accounts, need ${stillNeed} more`);
                })
                .catch(error => console.error('Failed to load accounts:', error));
        })
        .catch(error => console.error('Failed to load profiles:', error));
}

// Модифицировать существующие функции для обновления статуса
const originalLoadProfiles = loadProfiles;
loadProfiles = function() {
    originalLoadProfiles();
    updateAccountStatus();
};

const originalLoadAccounts = loadAccounts;
loadAccounts = function() {
    originalLoadAccounts();
    updateAccountStatus();
};

// Обновлять статус при добавлении/удалении профилей и аккаунтов
const originalAddProfile = addProfile;
addProfile = async function() {
    await originalAddProfile();
    setTimeout(updateAccountStatus, 500); // Небольшая задержка для обновления данных
};

const originalDeleteProfile = deleteProfile;
deleteProfile = async function(index) {
    await originalDeleteProfile(index);
    setTimeout(updateAccountStatus, 500);
};

// Слушаем изменения статуса аккаунтов
socket.on('account-status', () => {
    setTimeout(updateAccountStatus, 200);
});

// Обновляем статус при загрузке страницы
window.addEventListener('load', () => {
    setTimeout(updateAccountStatus, 1000);
});

// Периодическое обновление статуса
setInterval(updateAccountStatus, 10000); // Каждые 10 секунд

// Слушаем обновления статуса аккаунтов
socket.on('account-status', (data) => {
    loadAccounts(); // Перезагружаем список при изменении статуса
});

// Загружаем аккаунты при старте
window.addEventListener('load', () => {
    loadAccounts();
});

// Добавить в WebSocket events секцию в public/script.js
socket.on('saved-posts', (posts) => {
    console.log(`Received ${posts.length} saved posts from server`);
    
    // Очищаем контейнер перед загрузкой
    recentPosts.innerHTML = '';
    
    // Добавляем посты в правильном порядке (уже отсортированы на сервере)
    posts.forEach((post, index) => {
        console.log(`Loading saved post ${index + 1}/${posts.length}: @${post.username} at ${post.timestamp}`);
        addSavedPostToUI(post);
    });
    
    console.log(`Loaded ${posts.length} saved posts in correct order`);
});

// Новая функция для добавления сохраненных постов (без анимации)
function addSavedPostToUI(post) {
    if (!recentPosts) {
        console.error('recentPosts element not found');
        return;
    }
    
    const postElement = document.createElement('div');
    postElement.className = 'recent-post saved-post'; // Добавляем класс для saved постов
    
    // Форматируем время
    const time = new Date(post.timestamp).toLocaleTimeString();
    const currentPostTime = new Date(post.timestamp).getTime();
    
    // Для сохраненных постов не вычисляем интервал (слишком сложно при загрузке)
    const timingInfo = ' | Saved post';
    
    postElement.innerHTML = `
        <div class="post-header">
            <span class="post-username">@${post.username}</span>
            <span class="post-time" data-timestamp="${currentPostTime}">${time} (${post.parseTime || 0}ms)${timingInfo}</span>
            <span class="post-account">by ${post.parsedBy || 'unknown'}</span>
            ${post.tabId ? `<span class="post-tab">Tab #${post.tabId}</span>` : ''}
        </div>
        <div class="post-content">${post.content}</div>
        <div class="post-footer">
            <span class="post-ip">${post.accountIP || 'Direct'}</span>
            ${post.foundWith ? `<span class="post-selector">Found: ${post.foundWith}</span>` : ''}
            ${post.attempts ? `<span class="post-attempts">${post.attempts} attempts</span>` : ''}
            <span class="post-saved">💾 Saved</span>
        </div>
    `;
    
    // Добавляем В КОНЕЦ для сохранения порядка (посты уже отсортированы)
    recentPosts.appendChild(postElement);
}


// Принудительно обновляем статус при подключении
socket.on('connect', () => {
    addLogToUI({ level: 'info', message: 'Connected to server' });
});

socket.on('performance', (data) => {
    updatePerformanceMetrics(data);
});

// Добавить в public/script.js после других socket.on
socket.on('logs-cleared', () => {
    logsContainer.innerHTML = '';
    recentPosts.innerHTML = ''; // Также очищаем посты
    
    // Сбрасываем счетчики
    if (totalPosts) totalPosts.textContent = '0';
    if (totalErrors) totalErrors.textContent = '0';
    
    console.log('Logs and posts cleared');
});

// Добавить в public/script.js после других socket.on
socket.on('posts-cleared', () => {
    recentPosts.innerHTML = '';
    
    addLogToUI({ 
        level: 'info', 
        message: '🗑️ Recent posts cleared on all clients' 
    });
    
    console.log('Posts cleared by server');
});

// Инициализация
window.addEventListener('load', () => {
    loadProfiles();
    addLogToUI({ level: 'info', message: 'Web interface loaded' });
});

// Делаем функции глобальными для HTML onclick
window.deleteProfile = deleteProfile;


