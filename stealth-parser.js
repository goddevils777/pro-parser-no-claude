const { chromium } = require('playwright');
const { Cluster } = require('puppeteer-cluster');
const ProxyManager = require('./proxy-manager'); // Добавь импорт
const config = require('./config');
const logger = require('./logger');

class StealthParser {
    constructor() {
        this.browsers = [];
        this.sessions = new Map();
        this.proxyManager = new ProxyManager('./port_list.txt'); // Загружаем прокси
        this.token = 'BlChfq4xZWeEvTEPFYD1EmeY4iYLsitAiNh3VYP8g1o';
        this.lastPostIds = new Map();
        this.browserCount = 3; // Увеличиваем количество браузеров
    }

    async init() {
        await this.startBrowserFarm();
        logger.info('Stealth Parser initialized with browser farm');
    }

    async startBrowserFarm() {
    for (let i = 0; i < 1; i++) { // Тестируем только 1 браузер
        try {
   const browser = await chromium.launch({
    headless: false,
    args: [
        // Убираем следы автоматизации
        '--disable-blink-features=AutomationControlled',
        '--exclude-switches=enable-automation',
        '--disable-extensions',
        '--disable-plugins-discovery',
        '--disable-default-apps',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Убираем проблемную строку userDataDir
        '--disable-features=VizDisplayCompositor,TranslateUI',
        '--disable-ipc-flooding-protection',
        '--force-color-profile=srgb',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
    ]
});

const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
});

const page = await context.newPage();

// Максимальная маскировка
await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
    });

    window.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {}
    };

    Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
    });

    Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
    });
});
            
            console.log('Testing simple connection...');
            
            // Простейший тест
            await page.goto('https://truthsocial.com/@realDonaldTrump', { 
                waitUntil: 'networkidle',
                timeout: 60000 
            });
            
            console.log('Response status:', response.status());
            console.log('Response URL:', response.url());
            
            this.browsers.push({ browser, context, page });
            logger.info(`Test browser started successfully`);
            
        } catch (error) {
            console.error('Browser test failed:', error);
        }
    }
}

    parseProxy(proxyUrl) {
        const url = new URL(proxyUrl);
        return {
            host: url.hostname,
            port: url.port,
            username: url.username,
            password: url.password
        };
    }

    async bypassCloudflare() {
        for (let i = 0; i < this.browsers.length; i++) {
            const { page } = this.browsers[i];
            
            try {
                logger.info(`Browser ${i + 1}: Bypassing Cloudflare...`);
                
                await page.goto('https://truthsocial.com/@realDonaldTrump', { 
                    waitUntil: 'networkidle',
                    timeout: 60000 
                });

                // Ждём прохождения Cloudflare challenge
                // Ждём прохождения Cloudflare challenge
                await page.waitForFunction(
                    () => !document.title.includes('Just a moment') && 
                        !document.body.innerHTML.includes('Checking your browser') &&
                        !document.body.innerHTML.includes('403') &&
                        document.querySelector('[data-testid="post"], article') !== null,
                    { timeout: 30000 } // 30 секунд достаточно
                );

                // Дополнительная проверка что страница загрузилась
                const hasContent = await page.evaluate(() => {
                    return document.querySelectorAll('[data-testid="post"], article').length > 0;
                });

                if (!hasContent) {
                    throw new Error('Page content not loaded properly');
                }


                // Сохраняем сессию
                const cookies = await page.context().cookies();

                this.sessions.set(i, {
                    cookies,
                    page,
                    isValid: true
                });

                logger.info(`Browser ${i + 1}: Session saved. Cookies: ${cookies.length}, URL: ${page.url()}`);
                
            } catch (error) {
                logger.error(`Browser ${i + 1}: Cloudflare bypass failed:`, {
                    message: error.message,
                    url: page.url(),
                    title: await page.title().catch(() => 'unknown'),
                    timeout: error.name === 'TimeoutError'
                });
            }
        }
    }

    async parseLatestPost(username) {
        const startTime = Date.now();
        
        // Быстрый выбор случайного рабочего браузера
        const availableSessions = Array.from(this.sessions.entries()).filter(([key, session]) => session.isValid);
        
        if (availableSessions.length === 0) {
            logger.error('No valid sessions available');
            return null;
        }

        // Выбираем случайную сессию для распределения нагрузки
        const randomIndex = Math.floor(Math.random() * availableSessions.length);
        const [browserIndex, session] = availableSessions[randomIndex];

        try {
            const { page } = session;
            
            // Проверяем, находимся ли уже на нужной странице
            const currentUrl = page.url();
            if (!currentUrl.includes(`/@${username}`)) {
                await page.goto(`https://truthsocial.com/@${username}`, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 3000 // Уменьшаем timeout для скорости
                });
            }

            // Быстрое извлечение последнего поста
            const post = await page.evaluate(() => {
                const selectors = [
                    '[data-testid="post"]',
                    'article',
                    '.post-content',
                    '[role="article"]',
                    '.status',
                    '.timeline-item'
                ];
                
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
                    id: `${Date.now()}_${content.substring(0, 20).replace(/\s/g, '')}`,
                    content: content.substring(0, 500),
                    timestamp: new Date().toISOString(),
                    url: window.location.href
                };
            });

            const endTime = Date.now();
            const parseTime = endTime - startTime;
            
        if (post) {
            logger.info(`✅ Parse success for ${username}: ${parseTime}ms`);
            
            // Отправляем данные в веб-интерфейс
            if (global.sendStatsUpdate) {
                global.sendStatsUpdate({
                    totalPosts: (global.totalPosts || 0) + 1,
                    lastActivity: new Date().toISOString()
                });
                
                // Отправляем новый пост в интерфейс
                if (global.io) {
                    global.io.emit('new-post', {
                        username,
                        content: post.content,
                        timestamp: post.timestamp,
                        url: post.url
                    });
                }
                
                // Отправляем лог
                if (global.io) {
                    global.io.emit('log', {
                        level: 'success',
                        message: `New post from @${username}: ${post.content.substring(0, 50)}...`
                    });
                }
            }
        } else {
            logger.info(`⚪ No new posts for ${username}: ${parseTime}ms`);
            
            // Отправляем лог об отсутствии постов
            if (global.io) {
                global.io.emit('log', {
                    level: 'info',
                    message: `Checked @${username}: no new posts (${parseTime}ms)`
                });
            }
        }

            return post;

        } catch (error) {
            const endTime = Date.now();
            const parseTime = endTime - startTime;
            
            // Если браузер упал, помечаем сессию как неvalid
            if (error.message.includes('Target closed') || error.message.includes('Protocol error')) {
                this.sessions.get(browserIndex).isValid = false;
                logger.warn(`Browser ${browserIndex} session invalidated`);
            }
            
            logger.error(`❌ Parse error for ${username} (${parseTime}ms):`, error.message);


            // Отправляем ошибку в веб-интерфейс
            if (global.sendStatsUpdate) {
                global.sendStatsUpdate({
                    errors: (global.totalErrors || 0) + 1
                });
            }

            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `Parse error for @${username}: ${error.message} (${parseTime}ms)`
                });
            }
            
            return null;
        }
    }

    async close() {
        for (const { browser } of this.browsers) {
            await browser.close();
        }
        logger.info('Stealth Parser closed');
    }
}

module.exports = StealthParser;