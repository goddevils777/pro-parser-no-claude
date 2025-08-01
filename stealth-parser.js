const { chromium } = require('playwright');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const ProxyManager = require('./proxy-manager');

class StealthParser {
    constructor() {
        this.browsers = [];
        this.sessions = new Map();
        this.token = 'BlChfq4xZWeEvTEPFYD1EmeY4iYLsitAiNh3VYP8g1o';
        this.lastPostIds = new Map();
        this.currentSessionIndex = 0; // Вернули обратно
        this.proxyManager = new ProxyManager('./port_list.txt');
        
        // Новая система привязки IP к пользователям
        this.userProxyMap = new Map(); // username -> proxy
        this.userSessionMap = new Map(); // username -> session data
        this.activeIntervals = new Map(); // username -> interval ID
        this.failedAttempts = new Map(); // username -> attempts count

        this.browserPools = new Map(); // username -> массив браузеров
        this.poolSize = 3; // 3 браузера на пользователя
    }

    async init() {
        await this.createSessions();
        logger.info('Stealth Parser initialized with API sessions');
    }

async createSessions() {
  logger.info('Session system ready for parallel parsing');
}

async createUserSession(username) {
    let attempts = 0;
    const maxAttempts = 15; // Увеличили до 15 попыток
    
    while (attempts < maxAttempts) {
        try {
            const proxyUrl = this.proxyManager.getNextProxy();
            const proxy = proxyUrl ? this.proxyManager.parseProxy(proxyUrl) : null;
            
            logger.info(`Creating session for @${username} (attempt ${attempts + 1}/${maxAttempts}) with proxy ${proxy?.server || 'direct'}`);
            
            const browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                proxy: proxy
            });

            const page = await context.newPage();
            
            // Уменьшили timeout для быстрой проверки
            await page.goto('https://truthsocial.com', { 
                waitUntil: 'domcontentloaded',
                timeout: 10000 
            });

            // Быстрая проверка на блокировку
            const isBlocked = await page.evaluate(() => {
                return document.body.textContent.includes('you have been blocked') || 
                       document.body.textContent.includes('Unable to access') ||
                       document.body.textContent.includes('Access denied') ||
                       document.title.includes('blocked');
            });

            if (isBlocked) {
                await browser.close();
                logger.warn(`IP ${proxy?.server} is blocked, trying another...`);
                attempts++;
                continue;
            }

            // Уменьшили timeout для Cloudflare
            try {
                await page.waitForFunction(
                    () => !document.title.includes('Just a moment') && 
                          !document.body.innerHTML.includes('Checking your browser'),
                    { timeout: 10000 }
                );
            } catch (cfError) {
                // Если Cloudflare не прошли за 10 сек - пробуем следующий IP
                await browser.close();
                logger.warn(`Cloudflare timeout on ${proxy?.server}, trying another...`);
                attempts++;
                continue;
            }

            const cookies = await context.cookies();
            const userAgent = await page.evaluate(() => navigator.userAgent);
            
            this.userProxyMap.set(username, proxyUrl);
            
            this.userSessionMap.set(username, {
                cookies: cookies,
                userAgent: userAgent,
                proxy: proxy,
                isValid: true,
                createdAt: Date.now()
            });

            await browser.close();
            logger.info(`✅ Session created for @${username} with ${cookies.length} cookies (attempt ${attempts + 1})`);
            return;
            
        } catch (error) {
            attempts++;
            logger.warn(`Attempt ${attempts} failed for @${username}: ${error.message.substring(0, 100)}`);
            
            if (attempts >= maxAttempts) {
                logger.error(`❌ Failed to create session for @${username} after ${maxAttempts} attempts`);
                this.failedAttempts.set(username, 10);
                return;
            }
        }
    }
}

async parseUserWithStableIP(username, keywords) {
    const userSession = this.userSessionMap.get(username);
    
    if (!userSession || !userSession.isValid) {
        const skipCount = this.skipCounts?.get(username) || 0;
        if (skipCount % 10 === 0) {
            logger.info(`📋 Waiting for valid session: @${username}`);
        }
        this.skipCounts = this.skipCounts || new Map();
        this.skipCounts.set(username, skipCount + 1);
        return null;
    }
    
    // Получаем свободный браузер из пула
    const browserPool = this.browserPools.get(username);
    if (!browserPool) {
        return null;
    }
    
    const freeBrowser = browserPool.find(b => !b.isBusy);
    if (!freeBrowser) {
        if (global.io) {
            global.io.emit('log', {
                level: 'warning',
                message: `⚠️ @${username} all browsers busy, skipping...`
            });
        }
        return null;
    }
    
   freeBrowser.isBusy = true;
const startTime = Date.now();

try {
    logger.info(`🔍 @${username}: Starting parse...`);
    
    const page = await freeBrowser.context.newPage();
    logger.info(`📄 @${username}: Page created`);
    
    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            route.abort();
        } else {
            route.continue();
        }
    });
    logger.info(`🚫 @${username}: Resources blocked`);
    
    logger.info(`🌐 @${username}: Navigating to page...`);
        await page.goto(`https://truthsocial.com/@${username}`, { 
            waitUntil: 'load',
            timeout: 3000
        });
        logger.info(`✅ @${username}: Page loaded`);
        if (global.sendLogUpdate) {
            global.sendLogUpdate({ level: 'info', message: `✅ @${username}: Page loaded` });
        }
            
logger.info(`🔎 @${username}: Extracting posts...`);
if (global.sendLogUpdate) {
    global.sendLogUpdate({ level: 'info', message: `🔎 @${username}: Extracting posts...` });
}

const post = await page.evaluate(() => {
    // Сначала посмотрим что есть на странице
    console.log('Page title:', document.title);
    console.log('Body contains:', document.body.textContent.substring(0, 200));
    
    // Ищем все возможные элементы с текстом
    const allElements = document.querySelectorAll('*');
    const textElements = [];
    
    allElements.forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 10 && text.length < 500) {
            textElements.push({
                tag: el.tagName,
                text: text.substring(0, 100),
                className: el.className,
                id: el.id
            });
        }
    });
    
    console.log('Found text elements:', textElements.slice(0, 5));
    
    return null; // Пока возвращаем null для отладки
});

// ДОБАВИТЬ ЭТОТ БЛОК:
logger.info(`🔍 RESULT @${username}: ${post ? 'FOUND' : 'NULL'}`);
if (post) {
    logger.info(`📝 CONTENT @${username}: ${post.content.substring(0, 100)}`);
}

post = null; // Временно возвращаем null
    
    await page.close();
    const parseTime = Date.now() - startTime;

        if (post) {
            logger.info(`🎯 @${username}: FOUND POST in ${parseTime}ms`);
            if (global.sendLogUpdate) {
                global.sendLogUpdate({ level: 'success', message: `🎯 @${username}: FOUND POST in ${parseTime}ms` });
            }
        } else {
            logger.info(`📭 @${username}: No new posts (${parseTime}ms)`);
            if (global.sendLogUpdate) {
                global.sendLogUpdate({ level: 'info', message: `📭 @${username}: No new posts (${parseTime}ms)` });
            }
        }

    
        
        if (post && this.shouldNotify(post, keywords)) {
            logger.info(`🎯 NEW POST @${username} (${parseTime}ms)`);
            this.sendToInterface(post, username, parseTime);
        } else {


            const successCount = this.successCounts?.get(username) || 0;
            if (successCount % 5 === 0) {
                logger.info(`✅ Monitoring @${username} (${parseTime}ms)`);
            }
            this.successCounts = this.successCounts || new Map();
            this.successCounts.set(username, successCount + 1);
        }
        
        this.failedAttempts.set(username, 0);
        return post;
        
    } catch (error) {
        throw error;
    } finally {
        freeBrowser.isBusy = false; // Освобождаем браузер
    }
}

sendToInterface(post, username, parseTime) {
    if (global.io) {
        global.io.emit('new-post', {
            username,
            content: post.content,
            timestamp: post.timestamp,
            url: post.url,
            parseTime: parseTime // Добавляем время парсинга
        });
        
        global.io.emit('log', {
            level: 'success',
            message: `📍 @${username} (${parseTime}ms): ${post.content.substring(0, 50)}...`
        });
        
        // Отправляем метрики производительности
        global.io.emit('performance', {
            username: username,
            parseTime: parseTime,
            timestamp: Date.now()
        });
    }
}

async switchUserProxy(username) {
    logger.warn(`Switching proxy for @${username} after repeated failures`);
    
    // Закрываем старый браузер если есть
    const oldSession = this.userSessionMap.get(username);
    if (oldSession && oldSession.browser) {
        try {
            await oldSession.browser.close();
        } catch (e) {
            // Игнорируем ошибки закрытия
        }
        oldSession.browser = null;
        oldSession.context = null;
    }
    
    // Получаем новый прокси
    const newProxy = this.proxyManager.getNextProxy();
    this.userProxyMap.set(username, newProxy);
    
    // Помечаем старую сессию как невалидную
    if (oldSession) {
        oldSession.isValid = false;
    }
    
    // Создаем новую сессию
    await this.createUserSession(username);
    
    // Сбрасываем счетчик ошибок
    this.failedAttempts.set(username, 0);
    
    if (global.io) {
        global.io.emit('log', {
            level: 'warning',
            message: `🔄 Switched proxy for @${username} due to repeated failures`
        });
    }
}

async startParallelParsing(profiles) {
    this.activeIntervals = new Map();
    
    logger.info(`Creating sessions for ${profiles.length} profiles...`);
    
    // Отправляем статус в веб-интерфейс
    if (global.io) {
        global.io.emit('log', {
            level: 'info',
            message: `🔄 Creating sessions for ${profiles.length} profiles...`
        });
    }
    
    for (const profile of profiles) {
        // Назначаем уникальный прокси каждому пользователю
        if (!this.userProxyMap.has(profile.username)) {
            const proxy = this.proxyManager.getNextProxy();
            this.userProxyMap.set(profile.username, proxy);
            
            logger.info(`Assigned proxy to @${profile.username}: ${this.proxyManager.parseProxy(proxy)?.server}`);
            
            // Отправляем в веб-интерфейс
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `📡 Setting up @${profile.username}...`
                });
            }
        }
        
        
        // Создаем стабильную сессию для пользователя - ЖДЕМ завершения
        await this.createUserSession(profile.username);

        await this.createBrowserPool(profile.username, this.userSessionMap.get(profile.username));
        
        // Уведомляем о готовности сессии
        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `✅ Session ready for @${profile.username}`
            });
        }
    }
    
    logger.info('All user sessions created, starting monitoring...');
    
    // Остальной код без изменений...
    // Запускаем мониторинг только после создания всех сессий
    // Запускаем мониторинг только после создания всех сессий
    for (const profile of profiles) {
        // Увеличиваем интервал с 300ms до 2000ms (2 секунды)
        const interval = setInterval(async () => {
            await this.parseWithRetry(profile.username, profile.keywords);
        }, 5000);
        
        this.activeIntervals.set(profile.username, interval);
        logger.info(`Started monitoring @${profile.username} every 0.5s with ${this.poolSize} browsers`);
    }
}

async parseWithRetry(username, keywords, maxRetries = 3) {
    let attempts = 0;
    
    while (attempts < maxRetries) {
        try {
            const result = await this.parseUserWithStableIP(username, keywords);
            return result;
            
        } catch (error) {
            attempts++;
            
            if (attempts === maxRetries) {
                logger.warn(`@${username}: ${maxRetries} failures, switching proxy...`);
                await this.switchUserProxy(username);
                
                // Увеличиваем паузу после смены прокси до 30 секунд
                await new Promise(resolve => setTimeout(resolve, 30000));
                return null; // Возвращаем null чтобы прервать цикл
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    return null;
}

shouldNotify(post, keywords) {
    if (!keywords || keywords.length === 0) return true;
    
    const content = post.content.toLowerCase();
    return keywords.some(keyword => content.includes(keyword.toLowerCase()));
}

stopProfileMonitoring(username) {
    const interval = this.activeIntervals.get(username);
    if (interval) {
        clearInterval(interval);
        this.activeIntervals.delete(username);
        
        if (global.io) {
            global.io.emit('log', {
                level: 'error',
                message: `Stopped monitoring @${username} due to repeated IP failures`
            });
        }
    }
}

async createBrowserPool(username, userSession) {
    const browsers = [];
    
    for (let i = 0; i < this.poolSize; i++) {
        try {
            const browser = await chromium.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const context = await browser.newContext({
                userAgent: userSession.userAgent,
                proxy: userSession.proxy
            });
            
            await context.addCookies(userSession.cookies);
            
            browsers.push({ browser, context, isBusy: false });
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `🔧 Created browser ${i+1}/${this.poolSize} for @${username}`
                });
            }
            
        } catch (error) {
            logger.error(`Failed to create browser ${i+1} for ${username}: ${error.message}`);
        }
    }
    
    this.browserPools.set(username, browsers);
    logger.info(`Browser pool ready for @${username}: ${browsers.length} browsers`);
}



async stop() {
    // Останавливаем все интервалы мониторинга
    for (const [username, interval] of this.activeIntervals) {
        clearInterval(interval);
        logger.info(`Stopped monitoring @${username}`);
    }
    this.activeIntervals.clear();
    
    // Закрываем все браузеры пользователей
    for (const [username, session] of this.userSessionMap) {
        if (session.browser) {
            try {
                await session.browser.close();
            } catch (e) {
                // Игнорируем ошибки закрытия
            }
        }
    }
    
    await this.close();
    logger.info('Parser stopped completely');
}



async close() {
    this.sessions.clear();
    logger.info('Stealth Parser closed, sessions cleared');
}
}

module.exports = StealthParser;