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

// Сначала пробуем через API
try {
    const apiResult = await this.parseViaAPI(username);
    if (apiResult) {
        const parseTime = Date.now() - startTime;
        logger.info(`🚀 @${username}: API success (${parseTime}ms)`);
        return apiResult;
    }
} catch (apiError) {
    logger.warn(`🚀 @${username}: API failed, fallback to browser`);
}

try {
    logger.info(`🔍 @${username}: Starting parse...`);
    
    const page = await freeBrowser.context.newPage();
    logger.info(`📄 @${username}: Page created`);

    // Добавляем авторизацию
    await page.setExtraHTTPHeaders({
        'Authorization': `Bearer ${this.token}`,
        'X-Requested-With': 'XMLHttpRequest'
    });
    logger.info(`🔑 @${username}: Authorization token added`);
    

    logger.info(`🚫 @${username}: Heavy resources blocked, JS allowed`);
    
    logger.info(`🌐 @${username}: Navigating to page...`);
    await page.goto(`https://truthsocial.com/@${username}`, { 
        waitUntil: 'networkidle',
        timeout: 15000
    });

    // Ждем загрузки контента (Truth Social грузится через JS)
    await page.waitForTimeout(8000);
// Пытаемся проскроллить вниз чтобы загрузить контент
await page.evaluate(() => {
    window.scrollTo(0, 500);
});

// Ждем полного выполнения всех скриптов
await page.waitForLoadState('networkidle');
await page.waitForTimeout(5000);

// Проверяем что страница полностью загрузилась
const isLoaded = await page.evaluate(() => {
    return document.readyState === 'complete' && 
           window.performance.timing.loadEventEnd > 0;
});
logger.info(`📋 @${username}: Page fully loaded: ${isLoaded}`);

// Ждем загрузки React приложения
try {
    await page.waitForSelector('div[role="main"], main, [data-testid], .timeline', { 
        timeout: 15000 
    });
    logger.info(`⚛️ @${username}: React app loaded`);
} catch (e) {
    logger.warn(`⚛️ @${username}: React app not loaded, continuing anyway`);
}

await page.waitForTimeout(2000);
    

    logger.info(`✅ @${username}: Page loaded`);
        if (global.sendLogUpdate) {
            global.sendLogUpdate({ level: 'info', message: `✅ @${username}: Page loaded` });
        }
            
logger.info(`🔎 @${username}: Extracting posts...`);
if (global.sendLogUpdate) {
    global.sendLogUpdate({ level: 'info', message: `🔎 @${username}: Extracting posts...` });
}


// Делаем скриншот для отладки
await page.screenshot({ path: `debug-${username}.png`, fullPage: false });
logger.info(`📸 @${username}: Screenshot saved as debug-${username}.png`);

// Проверяем авторизованы ли мы
const authStatus = await page.evaluate(() => {
    // Ищем элементы которые показывают что мы залогинены
    const loginButton = document.querySelector('a[href="/auth/sign_in"], button:has-text("Log in")');
    const userMenu = document.querySelector('[data-testid="user-menu"], .user-avatar');
    
    return {
        hasLoginButton: !!loginButton,
        hasUserMenu: !!userMenu,
        currentUrl: window.location.href,
        bodyHasLogin: document.body.textContent.includes('Log in')
    };
});

logger.info(`🔐 AUTH @${username}: ${JSON.stringify(authStatus)}`);

// Проверяем на rate limit
const isRateLimit = await page.locator('text=You\'re going too fast').count() > 0;
if (isRateLimit) {
    logger.warn(`⏳ @${username}: Rate limited, waiting 10 seconds...`);
    await page.waitForTimeout(10000);
    return null; // Пропускаем этот запрос
}

// Закрываем cookie notice если есть
try {
    await page.locator('text=Accept').click({ timeout: 2000 });
    logger.info(`🍪 @${username}: Cookie notice accepted`);
} catch (e) {
    // Игнорируем если кнопки нет
}

const post = await page.evaluate(() => {
    const timeElements = document.querySelectorAll('time');
    const foundTimeData = [];
    
    timeElements.forEach((timeEl, index) => {
        const timeTitle = timeEl.getAttribute('title');
        const timeText = timeEl.textContent?.trim();
        
        // Смотрим что идёт после time элемента
        let nextElement = timeEl.nextElementSibling;
        let nextTexts = [];
        
        for (let j = 0; j < 3; j++) {
            if (nextElement) {
                const text = nextElement.textContent?.trim();
                if (text && text.length > 5) {
                    nextTexts.push(text.substring(0, 100));
                }
                nextElement = nextElement.nextElementSibling;
            }
        }
        
        foundTimeData.push({
            index: index,
            title: timeTitle,
            text: timeText,
            nextTexts: nextTexts
        });
    });
    
    return {
        totalTimeElements: timeElements.length,
        timeData: foundTimeData
    };
});

logger.info(`🕐 TIME @${username}: Found ${post.totalTimeElements} time elements`);
post.timeData.forEach(time => {
    logger.info(`⏰ Time${time.index}: "${time.text}" (${time.title}) -> next: ${JSON.stringify(time.nextTexts)}`);
});

if (post) {
    logger.info(`🎯 FOUND POST BY TIME @${username}: ${post.content.substring(0, 100)}`);
} else {
    logger.info(`📭 No posts found by time @${username}`);
}





// Добавь логирование результата после page.evaluate()
if (post && post.debug) {
    logger.info(`🔍 PAGE INFO @${username}: ${JSON.stringify(post.pageInfo)}`);
    logger.info(`🔍 TEXT ELEMENTS @${username}: ${JSON.stringify(post.textElements.slice(0, 3))}`);
}

// Отдельно логируем HTML
const pageHTML = await page.content();
logger.info(`🔍 HTML @${username}: ${pageHTML.substring(0, 2000)}`);

    
    await page.close();
    const parseTime = Date.now() - startTime;

        if (post) {
            // Проверяем это новый пост или уже видели
            const lastPostId = this.lastPostIds.get(username);
            
            if (lastPostId !== post.id && lastPostId !== post.content) {
                // Сохраняем ID нового поста
                this.lastPostIds.set(username, post.content);
                
                logger.info(`🎯 NEW POST @${username}: ${post.content.substring(0, 100)}`);
                
                // Отправляем в интерфейс только новые посты
                this.sendToInterface(post, username, parseTime);
                
                return post;
            } else {
                logger.info(`🔄 Same post @${username}: already seen`);
            }
        } else {
            logger.info(`📭 No posts found @${username}`);
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

async parseViaAPI(username) {
    try {
        const response = await axios.get(`https://truthsocial.com/api/v1/accounts/${username}/statuses`, {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'User-Agent': config.parser.userAgent
            },
            timeout: 5000
        });
        
        if (response.data && response.data.length > 0) {
            const latestPost = response.data[0];
            return {
                id: latestPost.id,
                content: latestPost.content,
                timestamp: latestPost.created_at,
                url: latestPost.url
            };
        }
        
        return null;
    } catch (error) {
        throw error;
    }
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