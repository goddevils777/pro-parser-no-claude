// browser-manager.js - Управление браузером для авторизации
const puppeteer = require('puppeteer');
const logger = require('./logger');
const TruthSocialAPI = require('./truth-social-api');




class BrowserManager {
    constructor(truthSocialAPI = null) {
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        this.truthSocialAPI = truthSocialAPI; // Сохраняем ссылку на API
    }
// Запуск браузера с автоматической сменой IP
  // Запуск браузера с автоматической сменой IP
    async startBrowser(maxRetries = 3) {
        logger.info(`🚀 Starting browser with ${maxRetries} max retries...`);
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            let currentProxy = null;
            
            try {
                logger.info(`🌐 Browser attempt ${attempt}/${maxRetries}...`);
                
                // Получаем новый прокси для каждой попытки
                currentProxy = await this.getProxyForAttempt(attempt);
                logger.info(`🔍 Got proxy for attempt ${attempt}: ${currentProxy ? 'YES' : 'NO'}`);
                
                if (currentProxy) {
                    logger.info(`🔗 Testing IP: ${currentProxy.substring(0, 50)}...`);
                } else {
                    logger.info(`🔗 Testing direct connection`);
                }
                
                // ПОЛНОСТЬЮ закрываем предыдущий браузер если был
                await this.forceCloseBrowser();
                logger.info(`✅ Previous browser closed`);
                
                // Настраиваем опции браузера
                const browserOptions = {
                    headless: false,
                    defaultViewport: null,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor',
                        '--disable-dev-shm-usage'
                    ]
                };

                // Добавляем прокси
                if (currentProxy) {
                    browserOptions.args.push(`--proxy-server=${currentProxy}`);
                    logger.info(`🔗 Added proxy to browser args: ${currentProxy.substring(0, 50)}...`);
                }

                // Запускаем браузер
                logger.info(`🌐 Launching Puppeteer browser...`);
                this.browser = await puppeteer.launch(browserOptions);
                logger.info(`✅ Browser launched successfully`);
                
                this.page = await this.browser.newPage();
                logger.info(`✅ New page created`);
                
                // Устанавливаем авторизацию прокси если нужна
                if (currentProxy && this.proxyAuth) {
                    await this.page.authenticate({
                        username: this.proxyAuth.username,
                        password: this.proxyAuth.password
                    });
                    logger.info(`🔐 Proxy authentication set`);
                }
                
                // Устанавливаем User-Agent
                await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                logger.info(`✅ User-Agent set`);
                
                // Тестируем IP - пробуем открыть Truth Social
                logger.info(`🧪 Testing IP connection to Truth Social...`);
                
               await this.page.goto('https://truthsocial.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });
                logger.info(`✅ Page loaded successfully`);

                // Ждем дольше для Cloudflare автопроверки
                await new Promise(resolve => setTimeout(resolve, 8000));
                logger.info(`✅ Extended wait completed`);
                
                // Проверяем еще раз после ожидания
                const pageContent = await this.page.content();
                const title = await this.page.title();
                
                logger.info(`📄 Final page title: "${title}"`);
                logger.info(`📄 Final page content length: ${pageContent.length} chars`);
                
                // Если все еще Cloudflare после долгого ожидания - оставляем открытым
                if (title.toLowerCase().includes('cloudflare')) {
                    logger.info(`🛡️ Cloudflare still active. Browser stays open for manual verification.`);
                    this.isRunning = true;
                    
                    return { 
                        success: true, 
                        message: `Browser opened but Cloudflare verification required. Please complete verification manually.`,
                        proxy: currentProxy || 'direct',
                        needsVerification: true
                    };
                }
                
                // Проверки успешности для других случаев
                const isValidPage = (
                    title.toLowerCase().includes('truth social') ||
                    title.toLowerCase().includes('sign in') ||
                    pageContent.includes('truth social') ||
                    pageContent.includes('sign_in')
                ) && !pageContent.includes('blocked');
                
                logger.info(`✅ Page validation result: ${isValidPage}`);
                
                if (isValidPage) {
                    // IP РАБОТАЕТ!
                    this.isRunning = true;
                    logger.info(`✅ IP ${currentProxy ? currentProxy.substring(0, 30) + '***' : 'direct'} WORKS! Browser ready.`);
                    
                    return { 
                        success: true, 
                        message: `Browser opened with working IP (attempt ${attempt})`,
                        proxy: currentProxy || 'direct'
                    };
                } else {
                    // IP НЕ РАБОТАЕТ
                    throw new Error(`IP blocked or Truth Social not accessible. Title: "${title}"`);
                }
                
            } catch (error) {
                // IP не работает - закрываем браузер и пробуем следующий
                logger.error(`❌ Attempt ${attempt} FAILED: ${error.message}`);
                
                // ПОЛНОСТЬЮ закрываем браузер
                await this.forceCloseBrowser();
                
                if (attempt < maxRetries) {
                    logger.info(`🔄 Trying next IP (${attempt + 1}/${maxRetries})...`);
                    await this.sleep(2000);
                } else {
                    logger.error(`❌ All ${maxRetries} IP attempts failed`);
                }
            }
        }
        
        // Все IP не работают
        this.isRunning = false;
        return { 
            success: false, 
            error: `No working IP found after ${maxRetries} attempts.` 
        };
    }

    // Принудительное закрытие браузера
    async forceCloseBrowser() {
        try {
            if (this.browser) {
                await this.browser.close();
            }
        } catch (error) {
            // Игнорируем ошибки закрытия
        } finally {
            this.browser = null;
            this.page = null;
            this.isRunning = false;
        }
    }

    // Извлечение Bearer токена
    async extractToken() {
        try {
            if (!this.page) {
                throw new Error('Browser page not available');
            }

            logger.info('🔍 Extracting Bearer token from browser...');

            // Ждем загрузки страницы
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Проверяем URL страницы
            const currentUrl = this.page.url();
            logger.info(`📍 Current page URL: ${currentUrl}`);

            // Если все еще на странице логина - пользователь не авторизован
            if (currentUrl.includes('/auth/sign_in') || currentUrl.includes('/login')) {
                return { 
                    success: false, 
                    error: 'Please complete login first. You are still on the login page.' 
                };
            }

            // Извлекаем токен из браузера
            const tokenData = await this.page.evaluate(() => {
                const results = {
                    localStorage: {},
                    sessionStorage: {},
                    cookies: document.cookie,
                    url: window.location.href
                };

                // Сканируем localStorage
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    results.localStorage[key] = value;
                }

                // Сканируем sessionStorage
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    const value = sessionStorage.getItem(key);
                    results.sessionStorage[key] = value;
                }

                return results;
            });

            logger.info(`🔍 Found ${Object.keys(tokenData.localStorage).length} localStorage items`);
            logger.info(`🔍 Found ${Object.keys(tokenData.sessionStorage).length} sessionStorage items`);
            logger.info(`🔍 Current URL: ${tokenData.url}`);

            // Ищем токен в данных
            let token = null;

            // Поиск в localStorage
            for (const [key, value] of Object.entries(tokenData.localStorage)) {
                logger.info(`🔍 Checking localStorage key: ${key}`);
                
                if (value && typeof value === 'string') {
                    try {
                        // Попытка парсинга JSON
                        if (value.startsWith('{') || value.startsWith('[')) {
                            const parsed = JSON.parse(value);
                            if (parsed.access_token) {
                                token = parsed.access_token;
                                logger.info(`✅ Found token in localStorage.${key}.access_token`);
                                break;
                            }
                        }
                        
                        // Прямой поиск токена
                        if (value.startsWith('ey') && value.length > 100) {
                            token = value;
                            logger.info(`✅ Found direct token in localStorage.${key}`);
                            break;
                        }
                    } catch (e) {
                        // Игнорируем ошибки парсинга
                    }
                }
            }

            // Поиск в sessionStorage если не найден в localStorage
            if (!token) {
                for (const [key, value] of Object.entries(tokenData.sessionStorage)) {
                    logger.info(`🔍 Checking sessionStorage key: ${key}`);
                    
                    if (value && typeof value === 'string') {
                        try {
                            if (value.startsWith('{') || value.startsWith('[')) {
                                const parsed = JSON.parse(value);
                                if (parsed.access_token) {
                                    token = parsed.access_token;
                                    logger.info(`✅ Found token in sessionStorage.${key}.access_token`);
                                    break;
                                }
                            }
                            
                            if (value.startsWith('ey') && value.length > 100) {
                                token = value;
                                logger.info(`✅ Found direct token in sessionStorage.${key}`);
                                break;
                            }
                        } catch (e) {
                            // Игнорируем ошибки парсинга
                        }
                    }
                }
            }

            if (token) {
                logger.info(`✅ Token extracted: ${token.substring(0, 20)}...`);
                return { success: true, token: token };
            } else {
                logger.warn('⚠️ Token not found. Available keys:');
                logger.warn(`localStorage: ${Object.keys(tokenData.localStorage).join(', ')}`);
                logger.warn(`sessionStorage: ${Object.keys(tokenData.sessionStorage).join(', ')}`);
                
                return { 
                    success: false, 
                    error: 'Token not found. Make sure you are fully logged in to Truth Social.' 
                };
            }

        } catch (error) {
            logger.error(`❌ Token extraction error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Получение прокси для попытки
// Получение прокси для попытки
    async getProxyForAttempt(attempt) {
        try {
            // Используем существующий ProxyManager из truth-social-api
            const proxy = truthSocialAPI.getBestProxy();
            
            if (proxy) {
                logger.info(`📡 Got proxy from TruthSocialAPI: ${proxy.substring(0, 30)}...`);
                return this.convertProxyFormat(proxy);
            } else {
                logger.info(`🔗 No proxy available from TruthSocialAPI, using direct connection`);
                return null;
            }
            
        } catch (error) {
            logger.warn(`⚠️ Error getting proxy from TruthSocialAPI: ${error.message}, using direct connection`);
            return null;
        }
    }

    // Преобразование формата прокси
// Преобразование формата прокси
    convertProxyFormat(proxy) {
        try {
            // Твой формат: http://username:password@ip:port
            const url = new URL(proxy);
            const host = url.hostname;
            const port = url.port;
            const username = url.username;
            const password = url.password;
            
            // Сохраняем данные авторизации
            if (username && password) {
                this.proxyAuth = {
                    username: username,
                    password: password
                };
                logger.info(`🔐 Proxy auth saved for user: ${username.substring(0, 10)}...`);
            } else {
                this.proxyAuth = null;
            }
            
            // Возвращаем простой формат ip:port
            const simpleProxy = `${host}:${port}`;
            
            logger.info(`🔧 Proxy converted: ${proxy.substring(0, 30)}... -> ${simpleProxy}`);
            return simpleProxy;
            
        } catch (error) {
            logger.error(`❌ Failed to convert proxy format: ${error.message}`);
            return proxy;
        }
    }

    // Добавление прокси в белый список
    async addProxyToWhiteList(proxy) {
        try {
            const ProxyManager = require('./proxy-manager');
            const proxyManager = new ProxyManager();
            await proxyManager.init();
            await proxyManager.addToWhiteList(proxy, 'browser_success');
            logger.info(`✅ Added working proxy to whitelist`);
        } catch (error) {
            logger.error(`Error adding proxy to whitelist: ${error.message}`);
        }
    }

    // Добавление прокси в черный список
    async addProxyToBlackList(proxy) {
        try {
            const ProxyManager = require('./proxy-manager');
            const proxyManager = new ProxyManager();
            await proxyManager.init();
            await proxyManager.addToBlackList(proxy, 'browser_failed');
            logger.info(`❌ Added failed proxy to blacklist`);
        } catch (error) {
            logger.error(`Error adding proxy to blacklist: ${error.message}`);
        }
    }

    // Пауза
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Закрытие браузера
    async closeBrowser() {
        try {
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
                this.page = null;
                this.isRunning = false;
                logger.info('🔒 Browser closed');
            }
        } catch (error) {
            logger.error(`Error closing browser: ${error.message}`);
        }
    }

    // Получение статуса
    getStatus() {
        return {
            isRunning: this.isRunning,
            hasPage: !!this.page
        };
    }
}

module.exports = BrowserManager;