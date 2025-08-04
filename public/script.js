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

// НОВЫЕ элементы для Real Interval статистики
const activeAccountsCount = document.getElementById('active-accounts-count');
const avgRealInterval = document.getElementById('avg-real-interval');
const minRealInterval = document.getElementById('min-real-interval');
const maxRealInterval = document.getElementById('max-real-interval');

const testProxyBtn = document.getElementById('test-proxy-btn');

// Переменные для отслеживания статистики
let realIntervals = [];

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
async function startParser() {
    try {
        console.log('Starting parser...');
        
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        
        const response = await fetch('/api/parser/start', { method: 'POST' });
        const result = await response.json();
        
        console.log('Start result:', result);
        
        if (result.success) {
            addLogToUI({ level: 'success', message: 'Parser started successfully' });
        } else {
            console.error('Start failed:', result.error);
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ Failed to start parser: ${result.error}` 
            });
            
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
                    message: '🔄 Will be changed back to 7 accounts after testing is complete' 
                });
            }
            
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
        }
    } catch (error) {
        console.error('Start error:', error);
        
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
        console.log('Stopping parser...');
        
        const response = await fetch('/api/parser/stop', { method: 'POST' });
        const result = await response.json();
        
        console.log('Stop result:', result);
        
        if (result.success) {
            addLogToUI({ level: 'info', message: 'Parser stopped' });
            
            startBtn.disabled = false;
            startBtn.textContent = 'Start Parser';
            stopBtn.disabled = true;
            
        } else {
            addLogToUI({ level: 'error', message: 'Failed to stop: ' + result.error });
        }
    } catch (error) {
        console.log('Stop error:', error);
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

// НАЙТИ функцию loadProfiles и ЗАМЕНИТЬ НА:
async function loadProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const profiles = await response.json();
        
        // Добавляем проверки на существование элементов
        if (profilesList) {
            profilesList.innerHTML = '';
        }
        
        if (profilesCount) {
            profilesCount.textContent = profiles.length;
        }
        
        if (profilesList) {
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
        }
    } catch (error) {
        console.error('Failed to load profiles:', error);
        addLogToUI({ level: 'error', message: 'Failed to load profiles: ' + error.message });
    }
}

// Функции обновления UI
function updateStats(stats) {
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

// ОБНОВЛЕННАЯ функция addPostToUI с сбором статистики Real Interval
function addPostToUI(post) {
    console.log('Adding NEW post to UI:', post.username, post.timestamp);
    
    if (!recentPosts) {
        console.error('recentPosts element not found');
        return;
    }
    
    const postElement = document.createElement('div');
    postElement.className = 'recent-post new-post';
    
    const time = new Date(post.timestamp).toLocaleTimeString();
    const currentPostTime = new Date(post.timestamp).getTime();
    
    // Вычисляем РЕАЛЬНЫЙ интервал с предыдущим постом
    const existingPosts = Array.from(recentPosts.children);
    let realInterval = null;
    
    if (existingPosts.length > 0) {
        for (let i = 0; i < existingPosts.length; i++) {
            const existingPost = existingPosts[i];
            const existingUsername = existingPost.querySelector('.post-username')?.textContent;
            
            if (existingUsername === `@${post.username}`) {
                const existingTimeStr = existingPost.querySelector('.post-time')?.dataset.timestamp;
                if (existingTimeStr) {
                    const existingTime = parseInt(existingTimeStr);
                    
                    if (existingTime < currentPostTime) {
                        realInterval = Math.round((currentPostTime - existingTime) / 1000);
                        console.log(`Found older post: current=${currentPostTime}, existing=${existingTime}, interval=${realInterval}s`);
                        break;
                    }
                }
            }
        }
    }
    
    // СОБИРАЕМ СТАТИСТИКУ Real Interval
    if (realInterval && realInterval > 0) {
        realIntervals.push(realInterval);
        
        // Ограничиваем массив последними 50 интервалами
        if (realIntervals.length > 50) {
            realIntervals = realIntervals.slice(-50);
        }
        
        // Обновляем статистику
        updateRealIntervalStats();
    }
    
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
    
    recentPosts.insertBefore(postElement, recentPosts.firstChild);
    
    while (recentPosts.children.length > 50) {
        recentPosts.removeChild(recentPosts.lastChild);
    }
    
    const totalPostsElement = document.getElementById('total-posts');
    if (totalPostsElement) {
        const currentCount = parseInt(totalPostsElement.textContent) || 0;
        totalPostsElement.textContent = currentCount + 1;
    }
    
    // Обновляем количество активных аккаунтов
    updateActiveAccountsCount();
    
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

// НОВЫЕ функции для Real Interval статистики
function updateRealIntervalStats() {
    if (realIntervals.length === 0) {
        if (avgRealInterval) avgRealInterval.textContent = '-';
        if (minRealInterval) minRealInterval.textContent = '-';
        if (maxRealInterval) maxRealInterval.textContent = '-';
        return;
    }
    
    const avg = Math.round(realIntervals.reduce((a, b) => a + b, 0) / realIntervals.length);
    const min = Math.min(...realIntervals);
    const max = Math.max(...realIntervals);
    
    if (avgRealInterval) avgRealInterval.textContent = avg + 's';
    if (minRealInterval) minRealInterval.textContent = min + 's';
    if (maxRealInterval) maxRealInterval.textContent = max + 's';
}

function updateActiveAccountsCount() {
    fetch('/api/accounts')
        .then(response => response.json())
        .then(accounts => {
            const activeCount = accounts.filter(acc => acc.status === 'authorized').length;
            if (activeAccountsCount) activeAccountsCount.textContent = activeCount;
        })
        .catch(error => console.error('Failed to update active accounts:', error));
}

function addLogToUI(log) {
    const logDiv = document.createElement('div');
    logDiv.className = `log-item ${log.level}`;
    logDiv.textContent = `[${new Date().toLocaleTimeString()}] ${log.message}`;
    
    logsContainer.insertBefore(logDiv, logsContainer.firstChild);
    
    while (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.lastChild);
    }
    
    logsContainer.scrollTop = 0;
}

// НАЙТИ функцию updateParseStats и ЗАМЕНИТЬ НА:
function updateParseStats(stats) {
    // Добавляем проверки на существование элементов
    const avgParseTimeEl = document.getElementById('avg-parse-time');
    const minParseTimeEl = document.getElementById('min-parse-time');
    const maxParseTimeEl = document.getElementById('max-parse-time');
    
    if (avgParseTimeEl) {
        avgParseTimeEl.textContent = stats.average > 0 ? stats.average + 'ms' : '0ms';
    }
    
    if (minParseTimeEl) {
        minParseTimeEl.textContent = stats.min < Infinity ? stats.min + 'ms' : '0ms';
    }
    
    if (maxParseTimeEl) {
        maxParseTimeEl.textContent = stats.max + 'ms';
    }
}

// === УПРАВЛЕНИЕ АККАУНТАМИ ===
const addAccountBtn = document.getElementById('add-account-btn');
const accountUsernameInput = document.getElementById('account-username-input');
const accountsList = document.getElementById('accounts-list');

if (addAccountBtn) addAccountBtn.addEventListener('click', addAccount);
if (accountUsernameInput) {
    accountUsernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addAccount();
    });
}

async function addAccount() {
    const username = accountUsernameInput.value.trim();
    
    if (!username) {
        alert('Please enter account username');
        return;
    }
    
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
            loadAccounts();
        } else {
            alert('Failed to add account: ' + result.error);
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        }
    } catch (error) {
        alert('Error: ' + error.message);
        addAccountBtn.disabled = false;
        addAccountBtn.textContent = 'Add Account';
    }
}

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
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        } else {
            alert('Failed to confirm: ' + result.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function deleteAccount(username) {
    if (!confirm(`Delete account ${username}?`)) return;
    
    try {
        const response = await fetch(`/api/accounts/${username}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            loadAccounts();
            addAccountBtn.disabled = false;
            addAccountBtn.textContent = 'Add Account';
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

async function loadAccounts() {
    try {
        const response = await fetch('/api/accounts');
        const accounts = await response.json();
        
        if (accountsList) {
            accountsList.innerHTML = '';
            
            accounts.forEach(account => {
                const accountDiv = document.createElement('div');
                accountDiv.className = `account-item ${account.status}`;
                
                const statusIcon = account.status === 'authorized' ? '✅' : 
                                 account.status === 'authorizing' ? '🔄' : '❌';
                
                // НАЙТИ блок создания accountDiv.innerHTML и ЗАМЕНИТЬ НА:
                accountDiv.innerHTML = `
                    <div class="account-info">
                        <span class="account-status">${statusIcon}</span>
                        <span class="account-username">${account.username}</span>
                        <span class="account-ip">${account.ip || 'No IP'}</span>
                        <span class="account-cookies">${account.cookiesCount || 0} cookies</span>
                        <span class="account-session" id="session-${account.username}">🔍 Checking...</span>
                    </div>
                    <div class="account-actions">
                        ${account.status === 'authorizing' ? 
                            `<button onclick="confirmAuthorization('${account.username}')" class="btn btn-success btn-sm">I'm Authorized</button>` : ''}
                        <button onclick="testSession('${account.username}')" class="btn btn-info btn-sm">Test Session</button>
                        <button onclick="deleteAccount('${account.username}')" class="btn btn-danger btn-sm">Delete</button>
                    </div>
                `;

                accountsList.appendChild(accountDiv);

                // Проверяем наличие сохраненной сессии
                checkSessionStatus(account.username);
            });
        }
        
        // Обновляем счетчик активных аккаунтов
        updateActiveAccountsCount();
        
    } catch (error) {
        console.error('Failed to load accounts:', error);
    }
}

function clearLogs() {
    socket.emit('clear-logs');
}

function clearPosts() {
    if (confirm('Are you sure you want to clear all recent posts?')) {
        recentPosts.innerHTML = '';
        socket.emit('clear-posts');
        addLogToUI({ 
            level: 'info', 
            message: '🗑️ Recent posts cleared' 
        });
        
        // Сбрасываем статистику Real Interval
        realIntervals = [];
        updateRealIntervalStats();
        
        console.log('Posts cleared by user');
    }
}

function updateAccountStatus() {
    fetch('/api/profiles')
        .then(response => response.json())
        .then(profiles => {
            const profilesCount = profiles.length;
            
            fetch('/api/accounts')
                .then(response => response.json())
                .then(accounts => {
                    const authorizedCount = accounts.filter(acc => acc.status === 'authorized' || acc.status === 'offline').length;
                    const requiredCount = profilesCount * 7;
                    const stillNeed = Math.max(0, requiredCount - authorizedCount);
                    
                    if (profilesCountStatus) profilesCountStatus.textContent = profilesCount;
                    if (authorizedCountStatus) authorizedCountStatus.textContent = authorizedCount;
                    if (requiredCountStatus) requiredCountStatus.textContent = requiredCount;
                    if (stillNeedStatus) {
                        stillNeedStatus.textContent = stillNeed;
                        stillNeedStatus.className = 'status-value ' + 
                            (stillNeed === 0 ? 'status-success' : 'status-warning');
                    }
                    
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
                })
                .catch(error => console.error('Failed to load accounts:', error));
        })
        .catch(error => console.error('Failed to load profiles:', error));
}


// Проверка статуса сессии
async function checkSessionStatus(username) {
    try {
        const response = await fetch(`/api/sessions/check/${username}`);
        const result = await response.json();
        
        const sessionElement = document.getElementById(`session-${username}`);
        if (sessionElement) {
            if (result.hasSession) {
                sessionElement.innerHTML = `💾 Session saved (${result.savedAt})`;
                sessionElement.className = 'account-session session-available';
            } else {
                sessionElement.innerHTML = '❌ No session';
                sessionElement.className = 'account-session session-missing';
            }
        }
    } catch (error) {
        const sessionElement = document.getElementById(`session-${username}`);
        if (sessionElement) {
            sessionElement.innerHTML = '❓ Unknown';
            sessionElement.className = 'account-session session-unknown';
        }
    }
}

// Тестирование сессии
async function testSession(username) {
    try {
        const testBtn = event.target;
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
        
        const response = await fetch(`/api/sessions/test/${username}`, { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            if (result.isValid) {
                alert(`✅ Session for ${username} is VALID! User is logged in.`);
                addLogToUI({ level: 'success', message: `✅ Session test passed for ${username}` });
            } else {
                alert(`❌ Session for ${username} is INVALID! User not logged in.`);
                addLogToUI({ level: 'warning', message: `❌ Session test failed for ${username}` });
            }
        } else {
            alert(`❌ Test failed: ${result.error}`);
            addLogToUI({ level: 'error', message: `❌ Session test error for ${username}: ${result.error}` });
        }
        
        testBtn.disabled = false;
        testBtn.textContent = 'Test Session';
        
    } catch (error) {
        alert(`Error: ${error.message}`);
        event.target.disabled = false;
        event.target.textContent = 'Test Session';
    }
}


// Добавить после других элементов DOM

if (testProxyBtn) testProxyBtn.addEventListener('click', testProxy);

// Функция тестирования прокси
async function testProxy() {
    try {
        testProxyBtn.disabled = true;
        testProxyBtn.textContent = 'Testing...';
        
        const response = await fetch('/api/proxy/test', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            testProxyBtn.textContent = `✅ Working (${result.loadTime}ms)`;
            testProxyBtn.className = 'btn btn-success';
            
            addLogToUI({ 
                level: 'success', 
                message: `✅ Proxy test successful: ${result.proxy} loaded Google in ${result.loadTime}ms` 
            });
        } else {
            testProxyBtn.textContent = '❌ Failed';
            testProxyBtn.className = 'btn btn-danger';
            
            addLogToUI({ 
                level: 'error', 
                message: `❌ Proxy test failed: ${result.error}` 
            });
        }
        
        // Возвращаем кнопку в исходное состояние через 3 секунды
        setTimeout(() => {
            testProxyBtn.disabled = false;
            testProxyBtn.textContent = 'Test Proxy';
            testProxyBtn.className = 'btn btn-info';
        }, 3000);
        
    } catch (error) {
        testProxyBtn.textContent = '❌ Error';
        testProxyBtn.className = 'btn btn-danger';
        
        addLogToUI({ 
            level: 'error', 
            message: `❌ Proxy test error: ${error.message}` 
        });
        
        setTimeout(() => {
            testProxyBtn.disabled = false;
            testProxyBtn.textContent = 'Test Proxy';
            testProxyBtn.className = 'btn btn-info';
        }, 3000);
    }
}

// Добавить в глобальные функции
window.testSession = testSession;


// Остальные WebSocket events
socket.on('saved-posts', (posts) => {
    console.log(`Received ${posts.length} saved posts from server`);
    recentPosts.innerHTML = '';
    posts.forEach((post, index) => {
        console.log(`Loading saved post ${index + 1}/${posts.length}: @${post.username} at ${post.timestamp}`);
        addSavedPostToUI(post);
    });
});

function addSavedPostToUI(post) {
    if (!recentPosts) return;
    
    const postElement = document.createElement('div');
    postElement.className = 'recent-post saved-post';
    
    const time = new Date(post.timestamp).toLocaleTimeString();
    const currentPostTime = new Date(post.timestamp).getTime();
    
    postElement.innerHTML = `
        <div class="post-header">
            <span class="post-username">@${post.username}</span>
            <span class="post-time" data-timestamp="${currentPostTime}">${time} (${post.parseTime || 0}ms) | Saved post</span>
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
    
    recentPosts.appendChild(postElement);
}

socket.on('logs-cleared', () => {
    logsContainer.innerHTML = '';
    recentPosts.innerHTML = '';
    
    if (totalPosts) totalPosts.textContent = '0';
    if (totalErrors) totalErrors.textContent = '0';
    
    realIntervals = [];
    updateRealIntervalStats();
});

socket.on('posts-cleared', () => {
    recentPosts.innerHTML = '';
    realIntervals = [];
    updateRealIntervalStats();
    
    addLogToUI({ 
        level: 'info', 
        message: '🗑️ Recent posts cleared on all clients' 
    });
});

socket.on('account-status', () => {
    setTimeout(updateAccountStatus, 200);
    setTimeout(loadAccounts, 200);
});

socket.on('connect', () => {
    addLogToUI({ level: 'info', message: 'Connected to server' });
});

// Инициализация при загрузке страницы
window.addEventListener('load', () => {
    loadProfiles();
    loadAccounts();
    updateActiveAccountsCount();
    updateRealIntervalStats();
    updateAccountStatus();
    addLogToUI({ level: 'info', message: 'Web interface loaded' });
});

// Периодическое обновление
setInterval(updateAccountStatus, 10000);
setInterval(updateActiveAccountsCount, 5000);

// Глобальные функции для HTML
window.deleteProfile = deleteProfile;
window.confirmAuthorization = confirmAuthorization;
window.deleteAccount = deleteAccount;