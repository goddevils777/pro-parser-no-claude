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
        try {
            const accountsPath = './data/authorized-accounts.json';
            if (await fs.pathExists(accountsPath)) {
                const accounts = await fs.readJson(accountsPath);
                
                for (const account of accounts) {
                    this.authorizedAccounts.set(account.username, {
                        ...account,
                        status: 'offline', // При загрузке все аккаунты offline
                        browser: null,
                        context: null
                    });
                }
                
                logger.info(`📋 Loaded ${accounts.length} authorized accounts from file`);
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

    // Подтверждение авторизации
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

            // Обновляем данные аккаунта
            account.status = 'authorized';
            account.authorizedAt = Date.now();
            account.cookies = cookies;
            account.fingerprint = fingerprint;

            // Сохраняем в файл
            await this.saveAuthorizedAccounts();

            logger.info(`💾 Account ${username} authorized successfully with ${cookies.length} cookies`);

            if (global.io) {
                global.io.emit('log', {
                    level: 'success',
                    message: `✅ Account ${username} authorized successfully!`
                });
                
                global.io.emit('account-status', {
                    username: username,
                    status: 'authorized'
                });
            }

            return {
                success: true,
                message: `Account ${username} authorized successfully`,
                cookiesCount: cookies.length
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
        
        logger.info(`🗑️ Removed account: ${username} and released its IP`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🗑️ Removed account: ${username} and released its IP`
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