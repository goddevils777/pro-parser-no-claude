// account-manager.js - Управление авторизацией аккаунтов
const { chromium } = require('playwright');
const fs = require('fs-extra');
const logger = require('./logger');

class AccountManager {
    constructor(proxyManager) {
        this.proxyManager = proxyManager;
        this.authorizedAccounts = new Map(); // username -> {browser, context, proxy, status}
    }

    // Загрузка авторизованных аккаунтов из файла
async loadAuthorizedAccounts() {
    // ДОБАВИТЬ В НАЧАЛО ФУНКЦИИ:
    logger.info('🔍 Starting to load authorized accounts...');
    
    try {
        const accountsPath = './data/authorized-accounts.json';
        logger.info(`🔍 Checking file: ${accountsPath}`);
        
        if (await fs.pathExists(accountsPath)) {
            logger.info('🔍 File exists, reading...');
            const accounts = await fs.readJson(accountsPath);
            logger.info(`🔍 Read ${accounts.length} accounts from file`);
            
            for (const account of accounts) {
                this.authorizedAccounts.set(account.username, {
                    ...account,
                    status: 'offline', // При загрузке все аккаунты offline
                    browser: null,
                    context: null
                });
            }
            
            logger.info(`📋 Loaded ${accounts.length} authorized accounts from file`);
            
            // Просто проверяем наличие сохраненных сессий (БЕЗ восстановления)
            let sessionsFound = 0;
            for (const account of accounts) {
                const sessionPath = `./data/sessions/${account.username}-session.json`;
                if (await fs.pathExists(sessionPath)) {
                    sessionsFound++;
                }
            }
            
            if (sessionsFound > 0) {
                logger.info(`💾 Found ${sessionsFound} saved sessions ready for restore when parser starts`);
            } else {
                logger.info(`💡 No saved sessions found - accounts will need fresh authorization`);
            }
            
        } else {
            logger.info(`📋 No authorized accounts file found - starting fresh`);
        }
    } catch (error) {
        logger.warn(`Failed to load authorized accounts: ${error.message}`);
    }
}

    // Сохранение списка авторизованных аккаунтов
    async saveAuthorizedAccounts() {
        try {
            const accounts = [];
            for (const [username, data] of this.authorizedAccounts) {
                accounts.push({
                    username: username,
                    proxy: data.proxy,
                    authorizedAt: data.authorizedAt,
                    cookies: data.cookies,
                    fingerprint: data.fingerprint
                });
            }
            
            await fs.ensureDir('./data');
            await fs.writeJson('./data/authorized-accounts.json', accounts);
            logger.info(`💾 Saved ${accounts.length} authorized accounts to file`);
        } catch (error) {
            logger.error(`Failed to save authorized accounts: ${error.message}`);
        }
    }


    // Сохранение полной сессии аккаунта (cookies + localStorage + sessionStorage)
async saveAccountSession(username) {
    try {
        const account = this.authorizedAccounts.get(username);
        if (!account || !account.context || !account.page) {
            logger.warn(`Cannot save session for ${username} - missing context or page`);
            return false;
        }
        
        logger.info(`💾 Saving full session for ${username}...`);
        
        // Получаем все данные сессии
        const cookies = await account.context.cookies();
        const localStorage = await account.page.evaluate(() => JSON.stringify(localStorage));
        const sessionStorage = await account.page.evaluate(() => JSON.stringify(sessionStorage));
        
        const sessionData = {
            username: username,
            cookies: cookies,
            localStorage: localStorage,
            sessionStorage: sessionStorage,
            proxy: account.proxy,
            fingerprint: account.fingerprint,
            savedAt: new Date().toISOString()
        };
        
        // Сохраняем в отдельный файл для каждого аккаунта
        await fs.ensureDir('./data/sessions');
        const sessionPath = `./data/sessions/${username}-session.json`;
        await fs.writeJson(sessionPath, sessionData);
        
        logger.info(`✅ Session saved for ${username}: ${cookies.length} cookies, ${localStorage.length} chars localStorage`);
        return true;
        
    } catch (error) {
        logger.error(`❌ Failed to save session for ${username}: ${error.message}`);
        return false;
    }
}

// НАЙТИ И ЗАМЕНИТЬ функцию restoreAccountSession:
async restoreAccountSession(username, context, page) {
    try {
        const sessionPath = `./data/sessions/${username}-session.json`;
        
        if (!await fs.pathExists(sessionPath)) {
            logger.info(`No saved session found for ${username}`);
            return false;
        }
        
        logger.info(`🔄 Restoring session for ${username}...`);
        
        const sessionData = await fs.readJson(sessionPath);
        
        // СНАЧАЛА восстанавливаем localStorage и sessionStorage
        if (sessionData.localStorage || sessionData.sessionStorage) {
            logger.info(`📦 Restoring storage for ${username}: localStorage ${sessionData.localStorage?.length || 0} chars, sessionStorage ${sessionData.sessionStorage?.length || 0} chars`);
            
            await page.addInitScript(`
                console.log('🔄 Restoring storage for ${username}...');
                
                // Очищаем существующие данные
                localStorage.clear();
                sessionStorage.clear();
                
                try {
                    // Восстанавливаем localStorage
                    const localStorageData = ${sessionData.localStorage || '{}'};
                    for (const [key, value] of Object.entries(localStorageData)) {
                        localStorage.setItem(key, value);
                    }
                    console.log('✅ localStorage restored:', Object.keys(localStorageData).length, 'items');
                    
                    // Восстанавливаем sessionStorage
                    const sessionStorageData = ${sessionData.sessionStorage || '{}'};
                    for (const [key, value] of Object.entries(sessionStorageData)) {
                        sessionStorage.setItem(key, value);
                    }
                    console.log('✅ sessionStorage restored:', Object.keys(sessionStorageData).length, 'items');
                    
                } catch (e) {
                    console.error('❌ Failed to restore storage:', e);
                }
            `);
        }
        
        // ЗАТЕМ восстанавливаем cookies
        if (sessionData.cookies && sessionData.cookies.length > 0) {
            await context.addCookies(sessionData.cookies);
            logger.info(`🍪 Restored ${sessionData.cookies.length} cookies for ${username}`);
        }
        
        logger.info(`✅ Session restored for ${username}: ${sessionData.cookies?.length || 0} cookies + storage`);
        return true;
        
    } catch (error) {
        logger.error(`❌ Failed to restore session for ${username}: ${error.message}`);
        return false;
    }
}

    // Поиск рабочего IP для авторизации
    async findWorkingIP() {
        let attempts = 0;
        const maxAttempts = 20;

        while (attempts < maxAttempts) {
            const proxy = this.getNextProxy();
            const proxyUrl = proxy ? `${proxy.server}` : 'direct';
            
            // Показываем статистику IP
            const stats = this.proxyManager.getProxiesStats();
            logger.info(`🔍 Testing IP: ${proxyUrl} (attempt ${attempts + 1}/${maxAttempts}) | Stats: ${stats.available}/${stats.total} available, ${stats.used} in use, ${stats.blacklisted} blacklisted`);

            try {
                const browser = await chromium.launch({
                    headless: false,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });

                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1280, height: 720 },
                    proxy: proxy
                });

                const page = await context.newPage();

                // Отключаем только картинки и медиа
                await page.route('**/*', (route) => {
                    const resourceType = route.request().resourceType();
                    if (['image', 'media'].includes(resourceType)) {
                        route.abort();
                    } else {
                        route.continue();
                    }
                });

                await page.goto('https://truthsocial.com/', { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });

                // Проверяем на блокировки
                const isBlocked = await page.evaluate(() => {
                    const bodyText = document.body.textContent;
                    const title = document.title;
                    
                    return title.includes('Just a moment') || 
                           bodyText.includes('Підтвердьте, що ви людина') ||
                           bodyText.includes('Checking your browser') ||
                           bodyText.includes('потрібно перевірити безпеку') ||
                           bodyText.includes('Sorry, you have been blocked') ||
                           bodyText.includes('You are unable to access truthsocial.com');
                });

                if (isBlocked) {
                    logger.warn(`🚫 IP ${proxyUrl} blocked - adding to blacklist`);
                    
                    // Добавляем заблокированный IP в блэклист
                    if (proxy) {
                        const originalProxyUrl = this.proxyManager.proxies.find(p => p.includes(proxy.server.split(':')[0]));
                        if (originalProxyUrl) {
                            await this.proxyManager.addBlacklistedProxy(originalProxyUrl, 'blocked during test');
                            logger.warn(`❌ Added blocked IP to blacklist: ${originalProxyUrl}`);
                        }
                    }
                    
                    await browser.close();
                    attempts++;
                    continue;
                }

                // IP работает! Добавляем в список рабочих и отмечаем как используемый
                if (proxy) {
                    const originalProxyUrl = this.proxyManager.proxies.find(p => p.includes(proxy.server.split(':')[0]));
                    if (originalProxyUrl) {
                        await this.proxyManager.addWorkingProxy(originalProxyUrl);
                        this.proxyManager.markProxyAsUsed(originalProxyUrl);
                        
                        // Показываем обновленную статистику
                        const updatedStats = this.proxyManager.getProxiesStats();
                        logger.info(`📊 IP Stats: ${updatedStats.working} working, ${updatedStats.used} in use, ${updatedStats.available} available, ${updatedStats.blacklisted} blacklisted`);
                        
                        logger.info(`✅ IP ${proxyUrl} works and reserved! Ready for authorization.`);
                        
                        return { browser, context, proxy, page, proxyUrl: originalProxyUrl };
                    }
                }

                logger.info(`✅ IP ${proxyUrl} works and reserved! Ready for authorization.`);
                return { browser, context, proxy, page, proxyUrl: null };

            } catch (error) {
                logger.warn(`❌ IP test failed: ${error.message.substring(0, 100)}`);
                
                // При сетевых ошибках тоже добавляем в блэклист
                if (error.message.includes('timeout') || error.message.includes('net::') || error.message.includes('ERR_')) {
                    if (proxy) {
                        const originalProxyUrl = this.proxyManager.proxies.find(p => p.includes(proxy.server.split(':')[0]));
                        if (originalProxyUrl) {
                            await this.proxyManager.addBlacklistedProxy(originalProxyUrl, 'network error');
                            logger.warn(`❌ Added timeout IP to blacklist: ${originalProxyUrl}`);
                        }
                    }
                }
                
                attempts++;
            }
        }

        throw new Error(`No working IP found after ${maxAttempts} attempts`);
    }

    // Начало авторизации аккаунта
    async startAccountAuthorization(username) {
        try {
            logger.info(`🚀 Starting authorization for account: ${username}`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `🚀 Opening browser for ${username} authorization...`
                });
            }

            // Находим рабочий IP и открываем браузер
            const browserData = await this.findWorkingIP();
            
            // Сохраняем данные браузера как "в процессе авторизации"
            this.authorizedAccounts.set(username, {
                username: username,
                browser: browserData.browser,
                context: browserData.context,
                proxy: browserData.proxy,
                page: browserData.page,
                proxyUrl: browserData.proxyUrl,
                status: 'authorizing',
                authorizedAt: null,
                cookies: null,
                fingerprint: null
            });

            // Отслеживаем закрытие браузера для освобождения IP
            browserData.browser.on('disconnected', () => {
                logger.warn(`❌ Browser closed for ${username} - releasing IP and marking as unauthorized`);
                
                const account = this.authorizedAccounts.get(username);
                if (account && account.proxyUrl) {
                    this.proxyManager.releaseProxy(account.proxyUrl);
                }
                
                if (account) {
                    account.status = 'offline';
                    account.browser = null;
                    account.context = null;
                }
                
                if (global.io) {
                    global.io.emit('account-status', {
                        username: username,
                        status: 'offline'
                    });
                }
            });

            if (global.io) {
                global.io.emit('log', {
                    level: 'success',
                    message: `✅ Browser opened for ${username} with reserved IP: ${browserData.proxy?.server}`
                });
                
                global.io.emit('account-status', {
                    username: username,
                    status: 'authorizing'
                });
            }

            return {
                success: true,
                message: `Browser opened for ${username}. Please login manually.`,
                ip: browserData.proxy?.server
            };

        } catch (error) {
            logger.error(`❌ Failed to start authorization for ${username}: ${error.message}`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `❌ Failed to open browser for ${username}: ${error.message}`
                });
            }

            return {
                success: false,
                message: error.message
            };
        }
    }


    async confirmAccountAuthorization(username) {
    try {
        const account = this.authorizedAccounts.get(username);
        
        if (!account || account.status !== 'authorizing') {
            throw new Error(`Account ${username} is not in authorization process`);
        }

        logger.info(`✅ Confirming authorization for ${username}`);

        // Получаем cookies и отпечаток браузера
        const cookies = await account.context.cookies();
        const fingerprint = await account.page.evaluate(() => {
            return {
                userAgent: navigator.userAgent,
                language: navigator.language,
                languages: navigator.languages,
                platform: navigator.platform,
                cookieEnabled: navigator.cookieEnabled,
                doNotTrack: navigator.doNotTrack,
                hardwareConcurrency: navigator.hardwareConcurrency,
                maxTouchPoints: navigator.maxTouchPoints,
                vendor: navigator.vendor,
                webdriver: navigator.webdriver,
                screenWidth: screen.width,
                screenHeight: screen.height,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            };
        });

        // Определяем реальный username из Truth Social
        const realUsername = await account.page.evaluate(() => {
            // Ищем username в различных местах на странице
            const selectors = [
                '[data-testid="UserName"]',
                '.profile-header .username',
                'meta[property="og:url"]',
                'link[rel="canonical"]',
                '.user-profile .username',
                '[class*="username"]',
                'meta[name="twitter:creator"]'
            ];
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    let username = element.textContent || element.getAttribute('content') || element.getAttribute('href');
                    if (username && username.includes('@')) {
                        // Извлекаем username из URL или текста
                        const match = username.match(/@([a-zA-Z0-9_]+)/);
                        if (match) return match[1];
                    }
                }
            }
            
            // Пробуем из URL
            const url = window.location.href;
            const urlMatch = url.match(/truthsocial\.com\/@([a-zA-Z0-9_]+)/);
            if (urlMatch) return urlMatch[1];
            
            // Ищем в заголовке страницы
            const title = document.title;
            const titleMatch = title.match(/@([a-zA-Z0-9_]+)/);
            if (titleMatch) return titleMatch[1];
            
            return null;
        });

        logger.info(`🔍 Detected real username: ${realUsername || 'unknown'} for session: ${username}`);



        // Обновляем данные аккаунта
        account.status = 'authorized';
        account.authorizedAt = Date.now();
        account.cookies = cookies;
        account.fingerprint = fingerprint;
        account.realUsername = realUsername; // ДОБАВЛЯЕМ РЕАЛЬНЫЙ USERNAME

        // АВТОМАТИЧЕСКИ СОХРАНЯЕМ ПОЛНУЮ СЕССИЮ
        const sessionSaved = await this.saveAccountSession(username);

        // Сохраняем в файл со списком аккаунтов
        await this.saveAuthorizedAccounts();

        logger.info(`💾 Account ${username} (real: @${realUsername || 'unknown'}) authorized successfully with ${cookies.length} cookies${sessionSaved ? ' + session saved' : ''}`);

        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `✅ Account ${username} authorized as @${realUsername || 'unknown'} + session auto-saved!`
            });
            
            global.io.emit('account-status', {
                username: username,
                status: 'authorized',
                realUsername: realUsername
            });
        }

        return {
            success: true,
            message: `Account ${username} authorized as @${realUsername || 'unknown'}`,
            cookiesCount: cookies.length,
            sessionSaved: sessionSaved,
            realUsername: realUsername
        };

    } catch (error) {
        logger.error(`❌ Failed to confirm authorization for ${username}: ${error.message}`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'error',
                message: `❌ Failed to confirm authorization for ${username}: ${error.message}`
            });
        }

        return {
            success: false,
            message: error.message
        };
    }
}


    // В account-manager.js добавить новый метод:
// Добавить в account-manager.js после функции removeAccount()
async switchProxyForAccount(username) {
    const account = this.authorizedAccounts.get(username);
    if (!account || !account.browser) {
        logger.warn(`❌ Cannot switch IP for ${username} - account not found or browser closed`);
        return false;
    }
    
    const oldIP = account.proxy?.server;
    logger.info(`🔄 Switching IP for ${username} from ${oldIP}...`);
    
    try {
        // Освобождаем старый IP
        if (account.proxyUrl) {
            this.proxyManager.releaseProxy(account.proxyUrl);
        }
        
        // Получаем новый IP
        const newProxy = this.getNextProxy();
        if (!newProxy) {
            logger.error(`❌ No available IP for ${username} - cannot switch`);
            return false;
        }
        
        const newProxyData = this.proxyManager.parseProxy(newProxy);
        logger.info(`🆕 New IP for ${username}: ${newProxyData.server}`);
        
        // Создаем новый контекст с новым IP
        const newContext = await account.browser.newContext({
            userAgent: account.fingerprint?.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            proxy: newProxyData
        });

        const tempPage = await newContext.newPage();

        // Восстанавливаем сессию в новом контексте
        await this.restoreAccountSession(username, newContext, tempPage);
        
        // Восстанавливаем cookies если есть
        if (account.cookies && account.cookies.length > 0) {
            await newContext.addCookies(account.cookies);
            logger.info(`🍪 Restored ${account.cookies.length} cookies for ${username}`);
        }
        
        // Закрываем старый контекст
        if (account.context) {
            await account.context.close();
        }
        
        // Обновляем данные аккаунта
        account.context = newContext;
        account.proxy = newProxyData;
        account.proxyUrl = newProxy;
        
        // Отмечаем новый IP как используемый
        this.proxyManager.markProxyAsUsed(newProxy);
        
        logger.info(`✅ Successfully switched IP for ${username}: ${oldIP} → ${newProxyData.server}`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `✅ ${username} switched IP: ${oldIP} → ${newProxyData.server}`
            });
        }
        
        return true;
        
    } catch (error) {
        logger.error(`❌ Failed to switch IP for ${username}: ${error.message}`);
        return false;
    }
}

    // Удаление аккаунта
    async removeAccount(username) {
        const account = this.authorizedAccounts.get(username);
        
        if (account) {
            // Освобождаем IP перед закрытием браузера
            if (account.proxyUrl) {
                this.proxyManager.releaseProxy(account.proxyUrl);
            }
            
            if (account.browser) {
                try {
                    await account.browser.close();
                } catch (e) {
                    // Игнорируем ошибки закрытия
                }
            }
        }
        
        this.authorizedAccounts.delete(username);
        await this.saveAuthorizedAccounts();

        try {
            const sessionPath = `./data/sessions/${username}-session.json`;
            if (await fs.pathExists(sessionPath)) {
                await fs.remove(sessionPath);
                logger.info(`🗑️ Deleted session file for ${username}`);
            }
        } catch (error) {
            logger.warn(`Failed to delete session file for ${username}: ${error.message}`);
        }
        
        logger.info(`🗑️ Removed account: ${username}, released IP and deleted session file`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🗑️ Removed account: ${username}, released IP and deleted session`
            });
        }
    }



    // Получение списка аккаунтов для веб-интерфейса
    getAccountsList() {
        const accounts = [];
        
        for (const [username, data] of this.authorizedAccounts) {
            accounts.push({
                username: username,
                status: data.status,
                ip: data.proxy?.server,
                authorizedAt: data.authorizedAt,
                cookiesCount: data.cookies?.length || 0
            });
        }
        
        return accounts;
    }

    // Получение авторизованных аккаунтов для парсинга
    getAuthorizedAccounts() {
        return Array.from(this.authorizedAccounts.values())
            .filter(account => account.status === 'authorized' && account.browser);
    }

    // Вспомогательная функция для получения следующего прокси
    getNextProxy() {
        const proxyUrl = this.proxyManager.getNextProxy();
        return proxyUrl ? this.proxyManager.parseProxy(proxyUrl) : null;
    }
}

module.exports = AccountManager;