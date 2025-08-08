// browser-manager.js - Управление браузером для авторизации (ИСПРАВЛЕННАЯ ВЕРСИЯ)
const puppeteer = require('puppeteer');
const logger = require('./logger');
const ProxyManager = require('./proxy-manager');

class BrowserManager {
    constructor(truthSocialAPI = null) {
        this.browser = null;
        this.page = null;
        this.isRunning = false;
        this.truthSocialAPI = truthSocialAPI;
        this.proxyManager = new ProxyManager(); // Добавляем ProxyManager
        this.proxyAuth = null; // Для хранения авторизации прокси
    }

    // Инициализация ProxyManager
    async init() {
        await this.proxyManager.init();
        logger.info('🚀 BrowserManager initialized with ProxyManager');
    }

    // Получение прокси для попытки (ИСПРАВЛЕНО)
    async getProxyForAttempt(attempt) {
        try {
            logger.info(`🔍 Getting proxy for attempt ${attempt}...`);
            
            // Получаем лучший прокси от ProxyManager
            const proxy = this.proxyManager.getBestProxy();
            
            if (proxy) {
                logger.info(`📡 Got proxy: ${proxy.substring(0, 30)}...`);
                return this.convertProxyFormat(proxy);
            } else {
                logger.info(`🔗 No proxy available, using direct connection`);
                return null;
            }
            
        } catch (error) {
            logger.warn(`⚠️ Error getting proxy: ${error.message}, using direct connection`);
            return null;
        }
    }

    // Преобразование формата прокси
    convertProxyFormat(proxy) {
        try {
            // Если прокси в формате http://username:password@ip:port
            if (proxy.includes('://')) {
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
                
                // Возвращаем формат ip:port для puppeteer
                return `${host}:${port}`;
            } else {
                // Прокси уже в формате ip:port
                this.proxyAuth = null;
                return proxy;
            }
            
        } catch (error) {
            logger.error(`❌ Failed to convert proxy format: ${error.message}`);
            return proxy;
        }
    }

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
                    logger.info(`🔗 Applied proxy: ${currentProxy}`);
                }

                // Запускаем браузер
                logger.info('🚀 Launching browser...');
                this.browser = await puppeteer.launch(browserOptions);
                
                // Открываем страницу
                this.page = await this.browser.newPage();
                
                // Настраиваем авторизацию прокси если нужно
                if (this.proxyAuth) {
                    await this.page.authenticate({
                        username: this.proxyAuth.username,
                        password: this.proxyAuth.password
                    });
                    logger.info(`🔐 Proxy authentication configured`);
                }
                
                // Настраиваем User-Agent
                await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                
                // Тестируем IP - идем на Truth Social
                logger.info('🧪 Testing Truth Social access...');
                await this.page.goto('https://truthsocial.com/auth/sign_in', { 
                    waitUntil: 'networkidle2',
                    timeout: 30000 
                });
                
                // Ждем загрузки
                await this.sleep(3000);
                
                // Проверяем заголовок страницы
                const title = await this.page.title();
                logger.info(`📄 Page title: "${title}"`);
                
                // Проверяем что это НЕ Cloudflare и НЕ блокировка
                if (title && 
                    !title.includes('Cloudflare') && 
                    !title.includes('Access denied') && 
                    !title.includes('Blocked') &&
                    (title.includes('Truth Social') || title.includes('Sign in') || title.includes('Login'))) {
                    
                    // IP РАБОТАЕТ!
                    if (currentProxy) {
                        await this.addProxyToWhiteList(currentProxy);
                    }
                    
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
                
                // Добавляем прокси в черный список
                if (currentProxy) {
                    await this.addProxyToBlackList(currentProxy);
                }
                
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
            // Поиск в localStorage (УЛУЧШЕННАЯ ВЕРСИЯ)
for (const [key, value] of Object.entries(tokenData.localStorage)) {
    logger.info(`🔍 Checking localStorage key: ${key}`);
    
   if (value && typeof value === 'string') {
    try {
        // Специальная обработка для truth:auth
        if (key === 'truth:auth') {
            logger.info(`🎯 Found truth:auth key, parsing...`);
            logger.info(`📋 RAW truth:auth value: ${value}`);
            
            try {
                const authData = JSON.parse(value);
                
                // ПОЛНОЕ логирование содержимого
                logger.info(`📋 FULL truth:auth content:`);
                logger.info(JSON.stringify(authData, null, 2));

                // ИЩЕМ ВСЕ ТОКЕНОПОДОБНЫЕ ЗНАЧЕНИЯ
                logger.info(`🔍 ALL TOKEN-LIKE VALUES IN truth:auth:`);
                const findAllTokens = (obj, path = '') => {
                    if (obj && typeof obj === 'object') {
                        for (const [subKey, subValue] of Object.entries(obj)) {
                            const currentPath = path ? `${path}.${subKey}` : subKey;
                            if (typeof subValue === 'string' && subValue.length > 20) {
                                logger.info(`📋 TOKEN CANDIDATE: ${currentPath} = "${subValue}" (length: ${subValue.length})`);
                                
                                // ПРИОРИТЕТ 1: Проверяем твой специфический токен
                                if (subValue.startsWith('9KlLCpjKrUi82-Xf9Iwo')) {
                                    logger.info(`🎯 FOUND YOUR SPECIFIC TOKEN: ${currentPath} = ${subValue}`);
                                    return subValue;
                                }
                            } else if (typeof subValue === 'object') {
                                const foundToken = findAllTokens(subValue, currentPath);
                                if (foundToken) return foundToken;
                            }
                        }
                    }
                    return null;
                };

                // Сначала ищем твой специфический токен
                const yourToken = findAllTokens(authData);
                if (yourToken) {
                    token = yourToken;
                    logger.info(`✅ Successfully found your specific token!`);
                    break;
                }

                // Если твой токен не найден - стандартная логика
                logger.info(`⚠️ Your specific token not found, trying standard logic...`);
                
                // Быстрые проверки на стандартные поля
                if (authData.access_token && authData.access_token.length > 30 && /^[a-zA-Z0-9._-]+$/.test(authData.access_token)) {
                    token = authData.access_token;
                    logger.info(`✅ Found Bearer token in truth:auth.access_token`);
                    break;
                }
                if (authData.token && authData.token.length > 30 && /^[a-zA-Z0-9._-]+$/.test(authData.token)) {
                    token = authData.token;
                    logger.info(`✅ Found Bearer token in truth:auth.token`);
                    break;
                }
                if (authData.accessToken && authData.accessToken.length > 30 && /^[a-zA-Z0-9._-]+$/.test(authData.accessToken)) {
                    token = authData.accessToken;
                    logger.info(`✅ Found Bearer token in truth:auth.accessToken`);
                    break;
                }
                
            } catch (parseError) {
                logger.error(`❌ Failed to parse truth:auth: ${parseError.message}`);
                logger.info(`📋 Raw value that failed: ${value.substring(0, 200)}...`);
            }
        }
        
        // Пропускаем registration data
        if (key === 'truth:registration-data') {
            logger.info(`⚠️ Skipping registration token (not Bearer token)`);
            continue;
        }
        
        // Попытка парсинга JSON для других ключей
        if (value.startsWith('{') || value.startsWith('[')) {
            const parsed = JSON.parse(value);
            if (parsed.access_token && parsed.access_token.length > 30 && /^[a-zA-Z0-9._-]+$/.test(parsed.access_token)) {
                token = parsed.access_token;
                logger.info(`✅ Found Bearer token in localStorage.${key}.access_token`);
                break;
            }
            if (parsed.token && parsed.token.length > 30 && /^[a-zA-Z0-9._-]+$/.test(parsed.token)) {
                token = parsed.token;
                logger.info(`✅ Found Bearer token in localStorage.${key}.token`);
                break;
            }
        }
        
        // Прямой поиск токена
        if (value.length > 30 && /^[a-zA-Z0-9._-]+$/.test(value)) {
            token = value;
            logger.info(`✅ Found direct Bearer token in localStorage.${key}`);
            break;
        }
        
    } catch (e) {
        logger.info(`⚠️ Failed to parse ${key}: ${e.message}`);
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
                logger.info(`🎫 Successfully extracted token: ${token.substring(0, 20)}...`);
                return { success: true, token: token };
            }

            // Токен не найден - выводим доступные ключи для отладки
            logger.warn(`❌ Token not found. Available keys:`);
            logger.warn(`localStorage: ${Object.keys(tokenData.localStorage).join(', ')}`);
            logger.warn(`sessionStorage: ${Object.keys(tokenData.sessionStorage).join(', ')}`);
            
            return { 
                success: false, 
                error: 'Token not found. Make sure you are fully logged in to Truth Social.' 
            };

        } catch (error) {
            logger.error(`❌ Token extraction error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Добавление прокси в белый список
    async addProxyToWhiteList(proxy) {
        try {
            await this.proxyManager.addToWhiteList(proxy, 'browser_success');
            logger.info(`✅ Added working proxy to whitelist`);
        } catch (error) {
            logger.error(`Error adding proxy to whitelist: ${error.message}`);
        }
    }

    // Добавление прокси в черный список
    async addProxyToBlackList(proxy) {
        try {
            await this.proxyManager.addToBlackList(proxy, 'browser_failed');
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