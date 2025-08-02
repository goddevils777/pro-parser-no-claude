const { chromium } = require('playwright');
const fs = require('fs-extra');
const logger = require('./logger');
const ProxyManager = require('./proxy-manager');

class StealthParser {
    constructor() {
        this.proxyManager = new ProxyManager('./port_list.txt');
        this.authorizedAccounts = new Map(); // username -> {browser, context, proxy, status}
        this.activeIntervals = new Map(); // username -> interval ID
        this.currentAccountIndex = 0; // Для ротации аккаунтов при парсинге
    }

    async init() {
        logger.info('Account management parser ready');
        
        // Загружаем список авторизованных аккаунтов при старте
        await this.loadAuthorizedAccounts();
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
            logger.info(`🔍 Testing IP: ${proxy?.server || 'direct'} (attempt ${attempts + 1}/${maxAttempts})`);

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
                    logger.warn(`🚫 IP ${proxy?.server} blocked`);
                    await browser.close();
                    attempts++;
                    continue;
                }

                // IP работает!
                logger.info(`✅ IP ${proxy?.server} works! Ready for authorization.`);
                
                return { browser, context, proxy, page };

            } catch (error) {
                logger.warn(`❌ IP test failed: ${error.message.substring(0, 100)}`);
                attempts++;
            }
        }

        throw new Error(`No working IP found after ${maxAttempts} attempts`);
    }

    // Начало авторизации аккаунта (вызывается из веб-интерфейса)
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
                status: 'authorizing',
                authorizedAt: null,
                cookies: null,
                fingerprint: null
            });

            // Отслеживаем закрытие браузера
            browserData.browser.on('disconnected', () => {
                logger.warn(`❌ Browser closed for ${username} - marking as unauthorized`);
                
                const account = this.authorizedAccounts.get(username);
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
                    message: `✅ Browser opened for ${username} with IP: ${browserData.proxy?.server}`
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

    // Подтверждение авторизации (вызывается из веб-интерфейса)
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

    // Удаление аккаунта
    async removeAccount(username) {
        const account = this.authorizedAccounts.get(username);
        
        if (account && account.browser) {
            try {
                await account.browser.close();
            } catch (e) {
                // Игнорируем ошибки закрытия
            }
        }
        
        this.authorizedAccounts.delete(username);
        await this.saveAuthorizedAccounts();
        
        logger.info(`🗑️ Removed account: ${username}`);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `🗑️ Removed account: ${username}`
            });
        }
    }

    // Парсинг поста с ротацией аккаунтов
    async parseUserPost(targetUsername) {
        // Получаем список авторизованных аккаунтов
        const authorizedAccounts = Array.from(this.authorizedAccounts.values())
            .filter(account => account.status === 'authorized' && account.browser);

        if (authorizedAccounts.length === 0) {
            logger.warn(`No authorized accounts available for parsing @${targetUsername}`);
            return null;
        }

        // Ротация аккаунтов
        const account = authorizedAccounts[this.currentAccountIndex % authorizedAccounts.length];
        this.currentAccountIndex++;

        if (!account.browser || !account.context) {
            logger.warn(`Account ${account.username} browser is not available`);
            return null;
        }

        const startTime = Date.now();

        try {
            // Создаем новую вкладку
            const page = await account.context.newPage();
            
            // Отключаем картинки, шрифты и медиа для скорости
            await page.route('**/*', (route) => {
                const resourceType = route.request().resourceType();
                if (['image', 'font', 'media'].includes(resourceType)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
            
            logger.info(`🔄 Parsing @${targetUsername} with account ${account.username} (IP: ${account.proxy?.server})`);

            // Отправляем в веб-интерфейс для сохранения
            if (global.sendLogUpdate) {
                global.sendLogUpdate({
                    level: 'info',
                    message: `🔄 Parsing @${targetUsername} with account ${account.username} (IP: ${account.proxy?.server})`
                });
            }

            await page.goto(`https://truthsocial.com/@${targetUsername}`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Дополнительное ожидание загрузки динамического контента
            try {
                await page.waitForSelector('article, [data-testid="post"], .status', { 
                    timeout: 10000 
                });
                logger.info(`📄 Posts container loaded for @${targetUsername}`);
            } catch (e) {
                logger.warn(`⚠️ No posts container found for @${targetUsername}, continuing anyway`);
            }

            // Ждем полной загрузки страницы и контента
            await new Promise(resolve => setTimeout(resolve, 200));

            // Проверяем на блокировки
            const isBlocked = await page.evaluate(() => {
                const bodyText = document.body.textContent;
                return bodyText.includes('Sorry, you have been blocked') ||
                       bodyText.includes('You are unable to access truthsocial.com');
            });

            if (isBlocked) {
                logger.warn(`🚫 Account ${account.username} blocked during parsing @${targetUsername}`);
                await page.close();
                return null;
            }

            // Парсим первый пост (улучшенные селекторы)
            const post = await page.evaluate(() => {
                console.log('🔍 Looking for posts on:', window.location.href);
                
                // Более широкий список селекторов
                const selectors = [
                    '[data-testid="post"]', 
                    '[data-testid="tweet"]',
                    'article',
                    '.status',
                    '[role="article"]',
                    '.post',
                    '.tweet',
                    '.stream-item',
                    '[class*="post"]',
                    '[class*="tweet"]',
                    '.content',
                    'main article',
                    'main div[role="article"]'
                ];
                
                let postElements = [];
                let foundSelector = '';
                
                for (const selector of selectors) {
                    postElements = document.querySelectorAll(selector);
                    if (postElements.length > 0) {
                        foundSelector = selector;
                        console.log(`✅ Found ${postElements.length} elements with selector: ${selector}`);
                        break;
                    }
                }
                
                if (postElements.length === 0) {
                    console.log('❌ No post elements found. Page content preview:');
                    console.log(document.body.textContent.substring(0, 500));
                    return null;
                }
                
                const firstPost = postElements[0];
                const content = firstPost.textContent?.trim();
                
                console.log(`📝 Found content (${content?.length} chars):`, content?.substring(0, 200));
                
                if (!content || content.length < 10) {
                    console.log('❌ Content too short or empty');
                    return null;
                }
                
                return {
                    id: `${Date.now()}_${Math.random()}`,
                    content: content.substring(0, 500),
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    foundWith: foundSelector
                };
            });

            // Ждем чтобы увидеть результат
            await new Promise(resolve => setTimeout(resolve, 200));
            await page.close();

            const parseTime = Date.now() - startTime;

            if (post) {
                logger.info(`🎯 POST FOUND @${targetUsername} (Account: ${account.username}, ${parseTime}ms): ${post.content.substring(0, 80)}...`);
                
                // Отправляем в веб-интерфейс для сохранения
                if (global.sendLogUpdate) {
                    global.sendLogUpdate({
                        level: 'success',
                        message: `🎯 POST FOUND @${targetUsername} (Account: ${account.username}, ${parseTime}ms): ${post.content.substring(0, 80)}...`
                    });
                }
                
                if (global.io) {
                    global.io.emit('new-post', {
                        username: targetUsername,
                        content: post.content,
                        timestamp: post.timestamp,
                        url: post.url,
                        parseTime: parseTime,
                        parsedBy: account.username,
                        accountIP: account.proxy?.server
                    });
                    
                    global.io.emit('log', {
                        level: 'success',
                        message: `🎯 POST: @${targetUsername} (by ${account.username}): ${post.content.substring(0, 50)}...`
                    });
                }
            } else {
                logger.info(`✅ No new posts @${targetUsername} (Account: ${account.username}, ${parseTime}ms)`);
                
                // Отправляем в веб-интерфейс для сохранения
                if (global.sendLogUpdate) {
                    global.sendLogUpdate({
                        level: 'info',
                        message: `✅ No new posts @${targetUsername} (Account: ${account.username}, ${parseTime}ms)`
                    });
                }
                
                if (global.io) {
                    global.io.emit('log', {
                        level: 'info',
                        message: `✅ @${targetUsername} checked by ${account.username} (${parseTime}ms)`
                    });
                }
            }

            return post;

        } catch (error) {
            logger.error(`❌ Parse error @${targetUsername} (Account: ${account.username}): ${error.message}`);
            
            // Отправляем ошибку в веб-интерфейс для сохранения
            if (global.sendLogUpdate) {
                global.sendLogUpdate({
                    level: 'error',
                    message: `❌ Parse error @${targetUsername} (Account: ${account.username}): ${error.message.substring(0, 100)}`
                });
            }
            
            return null;
        }
    }

    // Запуск мониторинга профилей
    async startMonitoring(profiles) {
        // Проверяем что есть достаточно авторизованных аккаунтов
        const authorizedCount = Array.from(this.authorizedAccounts.values())
            .filter(account => account.status === 'authorized').length;

        const requiredAccounts = profiles.length * 4;

        if (authorizedCount === 0) {
            throw new Error('No authorized accounts available. Please authorize at least one account.');
        }

        if (authorizedCount < requiredAccounts) {
            throw new Error(`Need ${requiredAccounts} accounts for ${profiles.length} profiles (4 accounts per profile). Currently have ${authorizedCount} accounts. Please authorize ${requiredAccounts - authorizedCount} more accounts.`);
        }

        logger.info(`🚀 Starting monitoring ${profiles.length} profiles with ${authorizedCount} authorized accounts`);

        for (const profile of profiles) {
            try {
                // Запускаем парсинг каждые 10 секунд
                const interval = setInterval(async () => {
                    await this.parseUserPost(profile.username);
                }, 1000);

                this.activeIntervals.set(profile.username, interval);
                logger.info(`✅ Monitoring @${profile.username} every 10s`);

            } catch (error) {
                logger.error(`❌ Failed to setup monitoring for @${profile.username}: ${error.message}`);
            }
        }

        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `🎯 Monitoring ${profiles.length} profiles with ${authorizedCount} authorized accounts`
            });
        }

        logger.info(`🎯 All profiles ready for monitoring!`);
    }

    // Остановка мониторинга (НЕ закрывает авторизованные браузеры)
    async stopMonitoring() {
        // Останавливаем только интервалы
        for (const [username, interval] of this.activeIntervals) {
            clearInterval(interval);
            logger.info(`Stopped monitoring @${username}`);
        }
        this.activeIntervals.clear();

        logger.info('Monitoring stopped (authorized browsers remain open)');
        
        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: 'Monitoring stopped (authorized browsers remain open)'
            });
        }
    }

    // Полная остановка (закрывает ВСЕ браузеры)
    async stop() {
        await this.stopMonitoring();

        // Закрываем все авторизованные браузеры
        for (const [username, account] of this.authorizedAccounts) {
            if (account.browser) {
                try {
                    await account.browser.close();
                    logger.info(`Closed browser for account: ${username}`);
                } catch (e) {
                    // Игнорируем ошибки
                }
                
                account.status = 'offline';
                account.browser = null;
                account.context = null;
            }
        }

        logger.info('Parser stopped completely (all browsers closed)');
    }

    // Вспомогательные функции
    getNextProxy() {
        const proxyUrl = this.proxyManager.getNextProxy();
        return proxyUrl ? this.proxyManager.parseProxy(proxyUrl) : null;
    }
}

module.exports = StealthParser;