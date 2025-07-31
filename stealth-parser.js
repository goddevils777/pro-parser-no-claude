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
    }

    async init() {
        await this.createSessions();
        logger.info('Stealth Parser initialized with API sessions');
    }

async createSessions() {
    // Создаем только 1 тестовую сессию для получения базовых кук
    await this.createBrowserSession(0);
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
        // Убираем спам - логируем только раз в 10 попыток
        const skipCount = this.skipCounts?.get(username) || 0;
        if (skipCount % 10 === 0) {
            logger.info(`📋 Waiting for valid session: @${username}`);
        }
        this.skipCounts = this.skipCounts || new Map();
        this.skipCounts.set(username, skipCount + 1);
        return null;
    }
    
    const startTime = Date.now();
    
    try {
        if (!userSession.browser) {
            userSession.browser = await chromium.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            userSession.context = await userSession.browser.newContext({
                userAgent: userSession.userAgent,
                proxy: userSession.proxy
            });
            
            await userSession.context.addCookies(userSession.cookies);
        }
        
        const page = await userSession.context.newPage();
        
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });
        
        await page.goto(`https://truthsocial.com/@${username}`, { 
            waitUntil: 'domcontentloaded',
            timeout: 8000  // Увеличили обратно до 8 секунд
        });
        
        const post = await page.evaluate(() => {
            const selectors = ['[data-testid="post"]', 'article', '.status', '[role="article"]'];
            let postElements = [];
            
            for (const selector of selectors) {
                postElements = document.querySelectorAll(selector);
                if (postElements.length > 0) break;
            }
            
            if (postElements.length === 0) return null;
            
            const firstPost = postElements[0];
            const content = firstPost.textContent?.trim();
            
            if (!content || content.length < 10) return null;
            
            return {
                id: `${Date.now()}_${Math.random()}`,
                content: content.substring(0, 400),
                timestamp: new Date().toISOString(),
                url: window.location.href
            };
        });
        
        await page.close();
        
        const parseTime = Date.now() - startTime;
        
        if (post && this.shouldNotify(post, keywords)) {
            logger.info(`🎯 NEW POST @${username} (${parseTime}ms)`);
            this.sendToInterface(post, username);
        } else {
            // Показываем только каждый 5-й успешный парсинг без постов
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
        // Не логируем каждую ошибку, только пробрасываем для retry
        throw error;
    }
}

sendToInterface(post, username) {
    if (global.io) {
        global.io.emit('new-post', {
            username,
            content: post.content,
            timestamp: post.timestamp,
            url: post.url
        });
        
        global.io.emit('log', {
            level: 'success',
            message: `📍 @${username}: ${post.content.substring(0, 60)}...`
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
    
    for (const profile of profiles) {
        // Назначаем уникальный прокси каждому пользователю
        if (!this.userProxyMap.has(profile.username)) {
            const proxy = this.proxyManager.getNextProxy();
            this.userProxyMap.set(profile.username, proxy);
            
            logger.info(`Assigned proxy to @${profile.username}: ${this.proxyManager.parseProxy(proxy)?.server}`);
        }
        
        // Создаем стабильную сессию для пользователя - ЖДЕМ завершения
        await this.createUserSession(profile.username);
    }
    
    logger.info('All user sessions created, starting monitoring...');
    
    // Запускаем мониторинг только после создания всех сессий
    for (const profile of profiles) {
        const interval = setInterval(async () => {
            await this.parseWithRetry(profile.username, profile.keywords);
        }, 300);
        
        this.activeIntervals.set(profile.username, interval);
        logger.info(`Started monitoring @${profile.username} every 0.3s with stable IP`);
    }
}

async parseWithRetry(username, keywords, maxRetries = 3) { // Уменьшили до 3 попыток
    let attempts = 0;
    
    while (attempts < maxRetries) {
        try {
            const result = await this.parseUserWithStableIP(username, keywords);
            return result;
            
        } catch (error) {
            attempts++;
            
            // Убираем спам - логируем только серьезные ошибки
            if (attempts === maxRetries) {
                logger.warn(`@${username}: ${maxRetries} failures, switching proxy...`);
                await this.switchUserProxy(username);
                
                // Пауза в 5 секунд после смены прокси
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
            // Небольшая пауза между попытками
            await new Promise(resolve => setTimeout(resolve, 1000));
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


   async createBrowserSession(index) {
    try {
        logger.info(`Creating session ${index + 1}...`);
        
        const proxyUrl = this.proxyManager.getNextProxy();
        const proxy = proxyUrl ? this.proxyManager.parseProxy(proxyUrl) : null;
        
        if (proxy) {
            logger.info(`Session ${index + 1}: Using proxy ${proxy.server}`);
        }

        const browser = await chromium.launch({
            headless: false,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            proxy: proxy
        });

        const page = await context.newPage();
        
        // Идем на главную сначала
        await page.goto('https://truthsocial.com', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // Ждем прохождения Cloudflare проверки
        await page.waitForFunction(
            () => !document.title.includes('Just a moment') && 
                  !document.body.innerHTML.includes('Checking your browser'),
            { timeout: 20000 }
        );

        logger.info(`Session ${index + 1}: Cloudflare passed, getting cookies...`);
        
        const cookies = await context.cookies();
        
        this.sessions.set(index, {
            cookies: cookies,
            userAgent: await page.evaluate(() => navigator.userAgent),
            isValid: true
        });

        await browser.close();
        logger.info(`Session ${index + 1} created successfully with ${cookies.length} cookies`);
        
    } catch (error) {
        logger.error(`Failed to create session ${index + 1}: ${error.message}`);
    }
}
async makeApiRequest(userId) {
    const sessionIndex = this.currentSessionIndex % this.sessions.size;
    const session = this.sessions.get(sessionIndex);
    
    if (!session || !session.isValid) {
        logger.error('No valid session available');
        return null;
    }

    try {
        const cookieString = session.cookies
            .map(cookie => `${cookie.name}=${cookie.value}`)
            .join('; ');

        logger.info(`Making API request with ${session.cookies.length} cookies`);

        const response = await axios.get(`https://truthsocial.com/api/v1/accounts/${userId}/statuses`, {
            params: { limit: 1 },
            headers: {
                'Cookie': cookieString,
                'User-Agent': session.userAgent,
                'Authorization': `Bearer ${this.token}`,
                'Accept': 'application/json',
                'Referer': 'https://truthsocial.com/',
                'Origin': 'https://truthsocial.com'
            },
            timeout: 5000
        });

        this.currentSessionIndex = (this.currentSessionIndex + 1) % this.sessions.size;
        logger.info(`API request successful, got ${response.data.length} posts`);
        return response.data;

    } catch (error) {
        logger.error(`API request failed: ${error.message}`);
        
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
        }
        
        if (error.response && [401, 403].includes(error.response.status)) {
            session.isValid = false;
            logger.error(`Session ${sessionIndex} marked as invalid`);
        }
        
        return null;
    }
}
async parseLatestPost(username) {
    const startTime = Date.now();
    
    const validSessions = Array.from(this.sessions.entries()).filter(([key, session]) => session.isValid);
    
    if (validSessions.length === 0) {
        logger.error('No valid sessions available');
        return null;
    }

    try {
        const browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const context = await browser.newContext({
            userAgent: validSessions[0][1].userAgent
        });
        
        await context.addCookies(validSessions[0][1].cookies);
        const page = await context.newPage();
        
        // Ускоряем загрузку - блокируем картинки и стили
        await page.route('**/*', (route) => {
            const resourceType = route.request().resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                route.abort();
            } else {
                route.continue();
            }
        });
        
        await page.goto(`https://truthsocial.com/@${username}`, { 
            waitUntil: 'domcontentloaded',
            timeout: 3000 
        });
        
        const post = await page.evaluate(() => {
            const postElements = document.querySelectorAll('[data-testid="post"], article, .status, [role="article"]');
            if (postElements.length === 0) return null;
            
            const firstPost = postElements[0];
            const content = firstPost.textContent?.trim();
            
            if (!content || content.length < 10) return null;
            
            return {
                id: `${Date.now()}_${Math.random()}`,
                content: content.substring(0, 300),
                timestamp: new Date().toISOString(),
                url: window.location.href
            };
        });
        
        await browser.close();
        
        const parseTime = Date.now() - startTime;
        
        if (post) {
            logger.info(`✅ Fast parse success for ${username}: ${parseTime}ms`);
            
            if (global.io) {
                global.io.emit('new-post', {
                    username,
                    content: post.content,
                    timestamp: post.timestamp,
                    url: post.url
                });
                
                global.io.emit('log', {
                    level: 'success',
                    message: `Found post from @${username} (${parseTime}ms): ${post.content.substring(0, 50)}...`
                });
            }
        } else {
            logger.info(`⚪ No posts for ${username}: ${parseTime}ms`);
        }
        
        return post;
        
    } catch (error) {
        const parseTime = Date.now() - startTime;
        logger.error(`❌ Parse error for ${username} (${parseTime}ms): ${error.message}`);
        return null;
    }
}



async close() {
    this.sessions.clear();
    logger.info('Stealth Parser closed, sessions cleared');
}
}

module.exports = StealthParser;