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
        this.proxyManager = new ProxyManager('./port_list.txt');
        
        this.userProxyMap = new Map();
        this.userSessionMap = new Map();
        this.activeIntervals = new Map();
        this.failedAttempts = new Map();
        this.browserPools = new Map();
        this.poolSize = 1; // Уменьшаем до 1 браузера на пользователя
    }

    async init() {
        logger.info('Stealth Parser initialized');
    }

    async createUserSession(username) {
        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts) {
            try {
                const proxyUrl = this.proxyManager.getNextProxy();
                const proxy = proxyUrl ? this.proxyManager.parseProxy(proxyUrl) : null;
                
                logger.info(`Creating session for @${username} (attempt ${attempts + 1})`);
                
                const browser = await chromium.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });

                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport: { width: 1280, height: 720 },
                    proxy: proxy
                });

                const page = await context.newPage();
                
                await page.goto('https://truthsocial.com', { 
                    waitUntil: 'domcontentloaded',
                    timeout: 10000 
                });

                const cookies = await context.cookies();
                
                this.userSessionMap.set(username, {
                    cookies: cookies,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    proxy: proxy,
                    isValid: true,
                    createdAt: Date.now()
                });

                await browser.close();
                logger.info(`✅ Session created for @${username}`);
                return;
                
            } catch (error) {
                attempts++;
                logger.warn(`Attempt ${attempts} failed for @${username}: ${error.message}`);
                
                if (attempts >= maxAttempts) {
                    logger.error(`❌ Failed to create session for @${username}`);
                    return;
                }
            }
        }
    }

async parseUserWithStableIP(username, keywords) {
    const browserPool = this.browserPools.get(username);
    const freeBrowser = browserPool?.find(b => !b.isBusy);
    if (!freeBrowser) return null;
    
    freeBrowser.isBusy = true;
    const startTime = Date.now();
    
    try {
        logger.info(`🚀 @${username}: Quick parse starting...`);
        
        const page = await freeBrowser.context.newPage();
        
        await page.goto(`https://truthsocial.com/@${username}`, { timeout: 8000 });
        
        // Добавляем отладку - что видит браузер
        const debugInfo = await page.evaluate(() => {
            return {
                url: window.location.href,
                title: document.title,
                bodyText: document.body?.textContent?.substring(0, 200) || 'NO BODY',
                statusWrappers: document.querySelectorAll('.status__wrapper').length,
                hasLoginForm: !!document.querySelector('input[type="email"]'),
                allSelectors: Array.from(document.querySelectorAll('*')).slice(0, 10).map(el => el.tagName)
            };
        });
        
        logger.info(`🔍 @${username} debug: ${JSON.stringify(debugInfo)}`);
        
        const post = await page.evaluate((targetUsername) => {
            const statusWrappers = document.querySelectorAll('.status__wrapper');
            
            if (statusWrappers.length === 0) {
                return null;
            }
            
            for (let wrapper of statusWrappers) {
                const text = wrapper.textContent?.trim();
                
                if (!text || text.length < 30) continue;
                if (text.includes('Sponsored')) continue;
                
                const hasAuthor = text.includes(`@${targetUsername}`) || text.includes(targetUsername);
                const mentions = (text.match(/@\w+/g) || []).length;
                
                if (hasAuthor && mentions <= 2) {
                    return {
                        content: text.substring(0, 500),
                        timestamp: new Date().toISOString()
                    };
                }
            }
            
            return null;
        }, username);

        await page.close();
        const parseTime = Date.now() - startTime;
        
        logger.info(`⚡ @${username}: Parse done in ${parseTime}ms`);

        if (post) {
            const lastPostContent = this.lastPostIds.get(username);
            
            if (!lastPostContent) {
                this.lastPostIds.set(username, post.content);
                logger.info(`📋 @${username}: Initial post saved (not notifying)`);
                return null;
            }
            
            if (lastPostContent !== post.content) {
                this.lastPostIds.set(username, post.content);
                logger.info(`🎯 NEW POST DETECTED @${username}: ${post.content.substring(0, 100)}`);
                
                this.sendToInterface({
                    content: post.content,
                    timestamp: new Date().toISOString(),
                    url: `https://truthsocial.com/@${username}`
                }, username, parseTime);
                
                return post;
            } else {
                logger.info(`🔄 @${username}: Same post (${parseTime}ms)`);
                return null;
            }
        } else {
            logger.info(`📭 @${username}: No posts found (${parseTime}ms)`);
            return null;
        }
        
    } catch (error) {
        logger.error(`❌ @${username}: ${error.message}`);
        return null;
    } finally {
        freeBrowser.isBusy = false;
    }
}

    
    sendToInterface(post, username, parseTime) {
        if (global.io) {
            global.io.emit('new-post', {
                username,
                content: post.content,
                timestamp: post.timestamp,
                url: post.url,
                parseTime: parseTime
            });
            
            global.io.emit('log', {
                level: 'success',
                message: `📍 @${username} (${parseTime}ms): ${post.content.substring(0, 50)}...`
            });
        }
    }

    async startParallelParsing(profiles) {
        // Останавливаем все старые интервалы
        for (const [username, interval] of this.activeIntervals) {
            clearInterval(interval);
            logger.info(`🛑 Stopped old monitoring for @${username}`);
        }
        this.activeIntervals.clear();
        
        // Закрываем все старые браузеры
        for (const [username, browsers] of this.browserPools) {
            for (const browserData of browsers) {
                try {
                    await browserData.browser.close();
                } catch (e) {}
            }
        }
        this.browserPools.clear();
        
        logger.info(`Creating sessions for ${profiles.length} profiles...`);
        
        // Создаем сессии и браузеры для каждого профиля
        for (const profile of profiles) {
            await this.createUserSession(profile.username);
            await this.createBrowserPool(profile.username, this.userSessionMap.get(profile.username));
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'success',
                    message: `✅ Session ready for @${profile.username}`
                });
            }
        }
        
        // Запускаем мониторинг
        for (const profile of profiles) {
            const interval = setInterval(async () => {
                try {
                    await this.parseUserWithStableIP(profile.username, profile.keywords);
                } catch (error) {
                    logger.error(`Monitoring error @${profile.username}: ${error.message}`);
                }
            }, 10000); // 10 секунд между запросами
            
            this.activeIntervals.set(profile.username, interval);
            logger.info(`Started monitoring @${profile.username} every 10s`);
        }
    }

    async createBrowserPool(username, userSession) {
        if (!userSession) return;
        
        const browsers = [];
        
        try {
            const browser = await chromium.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            const context = await browser.newContext({
                userAgent: userSession.userAgent,
                proxy: userSession.proxy
            });
            
            if (userSession.cookies && userSession.cookies.length > 0) {
                await context.addCookies(userSession.cookies);
            }
            
            browsers.push({ browser, context, isBusy: false });
            
        } catch (error) {
            logger.error(`Failed to create browser for ${username}: ${error.message}`);
        }
        
        this.browserPools.set(username, browsers);
        logger.info(`Browser pool ready for @${username}: ${browsers.length} browsers`);
    }

    shouldNotify(post, keywords) {
        if (!keywords || keywords.length === 0) return true;
        
        const content = post.content.toLowerCase();
        return keywords.some(keyword => content.includes(keyword.toLowerCase()));
    }

    async stop() {
        // Останавливаем все интервалы
        for (const [username, interval] of this.activeIntervals) {
            clearInterval(interval);
            logger.info(`Stopped monitoring @${username}`);
        }
        this.activeIntervals.clear();
        
        // Закрываем все браузеры
        for (const [username, browsers] of this.browserPools) {
            for (const browserData of browsers) {
                try {
                    await browserData.browser.close();
                } catch (e) {}
            }
        }
        this.browserPools.clear();
        
        logger.info('Parser stopped completely');
    }

    async close() {
        await this.stop();
        this.sessions.clear();
        logger.info('Stealth Parser closed');
    }
}

module.exports = StealthParser;