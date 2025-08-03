// tab-parser.js - Парсинг в отдельных вкладках
const logger = require('./logger');

class TabParser {
    constructor(proxyManager, timingTracker) {
        this.proxyManager = proxyManager;
        this.timingTracker = timingTracker;
        this.activeTabs = new Map(); // username -> количество активных вкладок
    }

    // Инициализация счетчиков для аккаунтов
    initializeTabCounters(accounts) {
        accounts.forEach(account => {
            this.activeTabs.set(account.username, 0);
        });
    }

    // Получить статистику вкладок
    getTabsStats() {
        const stats = {};
        
        for (const [username, tabCount] of this.activeTabs) {
            stats[username] = {
                activeTabs: tabCount,
                maxTabs: 2,
                utilization: Math.round((tabCount / 2) * 100)
            };
        }
        
        return stats;
    }

    // Управление параллельным парсингом
    startParallelParsing(targetUsername, accounts) {
        logger.info(`🚀 Starting controlled continuous parsing for @${targetUsername} with ${accounts.length} accounts (max 2 tabs per browser)`);
        
        let currentAccountIndex = 0;
        let tabCounter = 0;
        
        // Инициализируем счетчики вкладок для каждого аккаунта (МАКСИМУМ 2)
        this.initializeTabCounters(accounts);
        
        // Запускаем новую вкладку каждые 5 секунд
        const continuousInterval = setInterval(() => {
            // Ищем аккаунт с наименьшим количеством активных вкладок
            let selectedAccount = null;
            let minTabs = Infinity;
            
            for (let i = 0; i < accounts.length; i++) {
                const account = accounts[(currentAccountIndex + i) % accounts.length];
                const activeTabs = this.activeTabs.get(account.username) || 0;
                
                // Проверяем что аккаунт доступен и имеет менее 2 вкладок
                if (account && account.browser && account.context && activeTabs < 2) {
                    if (activeTabs < minTabs) {
                        minTabs = activeTabs;
                        selectedAccount = account;
                    }
                }
            }
            
            currentAccountIndex++;
            tabCounter++;
            
            if (selectedAccount) {
                const currentTabs = this.activeTabs.get(selectedAccount.username);
                
                logger.info(`🆕 [Tab #${tabCounter}] Opening new tab in ${selectedAccount.username} for @${targetUsername} (${currentTabs}/2 tabs active)`);
                
                // Увеличиваем счетчик активных вкладок
                this.activeTabs.set(selectedAccount.username, currentTabs + 1);
                
                // Запускаем парсинг в новой вкладке (не ждем результата)
                this.parseInNewTab(targetUsername, selectedAccount, tabCounter).catch(error => {
                    logger.error(`❌ [Tab #${tabCounter}] Error in ${selectedAccount.username}: ${error.message}`);
                }).finally(() => {
                    // Уменьшаем счетчик при закрытии вкладки
                    const tabs = this.activeTabs.get(selectedAccount.username) || 0;
                    this.activeTabs.set(selectedAccount.username, Math.max(0, tabs - 1));
                    logger.info(`📉 [Tab #${tabCounter}] ${selectedAccount.username} now has ${Math.max(0, tabs - 1)}/2 tabs active`);
                });
                
            } else {
                // Все браузеры заполнены до максимума
                const tabStatus = accounts.map(acc => 
                    `${acc.username}:${this.activeTabs.get(acc.username) || 0}/2`
                ).join(', ');
                
                logger.info(`⚡ All browsers working at capacity (2 tabs each) - ${tabStatus}`);
                
                if (global.io) {
                    global.io.emit('log', {
                        level: 'info',
                        message: `⚡ All browsers active (2 tabs each) - ${accounts.length} browsers working`
                    });
                }
            }
            
        }, 5000); // Каждые 5 секунд новая вкладка

        return continuousInterval;
    }

    // Парсинг в новой вкладке
    async parseInNewTab(targetUsername, account, tabId) {
        const startTime = Date.now();
        let page = null;
        
        try {
            const currentTabs = this.activeTabs.get(account.username) || 0;
            logger.info(`🔄 [Tab #${tabId}] [${account.username}] Starting parse @${targetUsername} (${currentTabs}/2 tabs in browser)`);
            
            // Отправляем лог для сохранения
            if (global.sendLogUpdate) {
                global.sendLogUpdate({
                    level: 'info',
                    message: `🔄 [Tab #${tabId}] [${account.username}] Starting parse @${targetUsername} (${currentTabs}/2 tabs)`
                });
            }
            
            // Создаем новую вкладку
            page = await account.context.newPage();
            
            // Настройка маршрутов для скорости
            await page.route('**/*', (route) => {
                const resourceType = route.request().resourceType();
                if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
            
            // Переходим на страницу пользователя
            const targetUrl = `https://truthsocial.com/@${targetUsername}`;
            logger.info(`📍 [Tab #${tabId}] [${account.username}] Navigating to ${targetUrl}`);
            
            await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            
            logger.info(`📄 [Tab #${tabId}] [${account.username}] Page loaded for @${targetUsername}`);

            // ГЛАВНАЯ ЛОГИКА: ждем пост в цикле, не закрываем пока не найдем
            let attempts = 0;
            const maxAttempts = 60; // 60 попыток = 1 минута ожидания
            
            while (attempts < maxAttempts) {
                try {
                    // Проверяем что вкладка и браузер еще открыты
                    if (page.isClosed() || !account.browser || !account.context) {
                        logger.warn(`❌ [Tab #${tabId}] [${account.username}] Page or browser closed - stopping parsing`);
                        break;
                    }
                    
                    // Ждем появления постов
                    await page.waitForSelector('article, [data-testid="post"], .status', { 
                        timeout: 3000 
                    });
                    
                    // Дополнительное ожидание загрузки динамического контента
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Проверяем на блокировки
                    const blockCheck = await page.evaluate(() => {
                        const bodyText = document.body.textContent || '';
                        const title = document.title || '';
                        
                        const isBlocked = title.includes('Just a moment') || 
                                        bodyText.includes('Підтвердьте, що ви людина') ||
                                        bodyText.includes('Checking your browser') ||
                                        bodyText.includes('Sorry, you have been blocked') ||
                                        bodyText.includes('You are unable to access truthsocial.com');
                        
                        return { isBlocked, title, bodyPreview: bodyText.substring(0, 100) };
                    });
                    
                    if (blockCheck.isBlocked) {
                        logger.warn(`🚫 [Tab #${tabId}] [${account.username}] Page blocked: ${blockCheck.title}`);
                        
// Отправляем лог для сохранения
                        if (global.sendLogUpdate) {
                            global.sendLogUpdate({
                                level: 'error',
                                message: `🚫 [Tab #${tabId}] [${account.username}] Page blocked for @${targetUsername}`
                            });
                        }
                        
                        // Добавляем IP в блэклист
                        if (account.proxy && account.proxy.server) {
                            const proxyUrl = `http://${account.proxy.username}:${account.proxy.password}@${account.proxy.server}`;
                            await this.proxyManager.addBlacklistedProxy(proxyUrl, 'blocked during parsing');
                        }
                        
                        break; // Выходим из цикла ожидания
                    }
                    
                    // Ищем посты
                    const post = await page.evaluate(() => {
                        const selectors = [
                            '[data-testid="post"]', 
                            '[data-testid="tweet"]',
                            'article',
                            '.status',
                            '[role="article"]',
                            'main article',
                            '.feed article'
                        ];
                        
                        for (const selector of selectors) {
                            const postElements = document.querySelectorAll(selector);
                            
                            for (let i = 0; i < Math.min(postElements.length, 3); i++) {
                                const postElement = postElements[i];
                                const content = postElement.textContent?.trim();
                                
                                if (content && content.length > 20) {
                                    return {
                                        id: `${Date.now()}_${Math.random()}`,
                                        content: content.substring(0, 500),
                                        timestamp: new Date().toISOString(),
                                        url: window.location.href,
                                        foundWith: selector,
                                        postIndex: i
                                    };
                                }
                            }
                        }
                        
                        return null;
                    });
                    
                    if (post) {
                        const totalTime = Date.now() - startTime;
                        
                        // УСПЕХ! Получили пост
                        const timingStats = this.timingTracker.trackPostTiming(targetUsername, post.content);
                        
                        logger.info(`🎯 [Tab #${tabId}] [${account.username}] POST FOUND @${targetUsername} (${totalTime}ms, attempt ${attempts + 1}): ${post.content.substring(0, 80)}...`);
                        
                        // Отправляем лог для сохранения
                        if (global.sendLogUpdate) {
                            global.sendLogUpdate({
                                level: 'success',
                                message: `🎯 [Tab #${tabId}] POST FOUND @${targetUsername} (${account.username}, ${totalTime}ms): ${post.content.substring(0, 80)}...`
                            });
                        }
                        
                        if (global.io) {
                            global.io.emit('new-post', {
                                username: targetUsername,
                                content: post.content,
                                timestamp: post.timestamp,
                                url: post.url,
                                parseTime: totalTime,
                                parsedBy: account.username,
                                accountIP: account.proxy?.server,
                                tabId: tabId,
                                attempts: attempts + 1,
                                timingStats: timingStats,
                                foundWith: post.foundWith
                            });
                            
                            global.io.emit('log', {
                                level: 'success',
                                message: `🎯 [Tab #${tabId}] POST @${targetUsername} by ${account.username} (${totalTime}ms): ${post.content.substring(0, 50)}...`
                            });
                            
                            if (timingStats) {
                                global.io.emit('log', {
                                    level: 'timing',
                                    message: `⏰ Post interval: ${Math.round(timingStats.interval/1000)}s (avg: ${Math.round(timingStats.avgInterval/1000)}s)`
                                });
                            }
                        }
                        
                        // ЗАКРЫВАЕМ ВКЛАДКУ - задача выполнена!
                        if (!page.isClosed()) {
                            await page.close();
                            logger.info(`✅ [Tab #${tabId}] [${account.username}] Tab closed after successful post retrieval`);
                        }
                        return;
                    }
                    
                    // Пост не найден - ждем еще
                    attempts++;
                    logger.info(`📭 [Tab #${tabId}] [${account.username}] No post yet @${targetUsername} (attempt ${attempts}/${maxAttempts}) - waiting...`);
                    
                    // ЧАСТИЧНОЕ ОБНОВЛЕНИЕ вместо полной перезагрузки страницы
                    if (attempts % 8 === 0) {  // Каждые 8 попыток
                        try {
                            logger.info(`🔄 [Tab #${tabId}] [${account.username}] Refreshing content (partial update)`);
                            
                            // Пытаемся обновить только контент без полной перезагрузки
                            await page.evaluate(() => {
                                // Скроллим чтобы активировать загрузку новых постов
                                window.scrollTo(0, 0);
                                
                                // Имитируем нажатие F5 через JavaScript (мягкая перезагрузка)
                                if (typeof window.location.reload === 'function') {
                                    window.location.reload(false); // false = из кэша
                                }
                            });
                            
                            // Ждем загрузки после мягкого обновления
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                            logger.info(`✅ [Tab #${tabId}] [${account.username}] Content refresh completed`);
                            
                        } catch (refreshError) {
                            logger.warn(`⚠️ [Tab #${tabId}] [${account.username}] Content refresh failed: ${refreshError.message}`);
                            
                            // Если мягкое обновление не сработало, пробуем полную перезагрузку
                            try {
                                if (!page.isClosed()) {
                                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
                                }
                            } catch (hardRefreshError) {
                                logger.warn(`⚠️ [Tab #${tabId}] [${account.username}] Hard refresh also failed: ${hardRefreshError.message}`);
                            }
                        }
                    }
                    
                    // Ждем перед следующей попыткой
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 секунды между попытками
                    
                } catch (waitError) {
                    attempts++;
                    
                    // Проверяем причину ошибки
                    if (waitError.message.includes('Target page, context or browser has been closed')) {
                        logger.warn(`❌ [Tab #${tabId}] [${account.username}] Browser/page closed - stopping parsing`);
                        break;
                    }
                    
                    logger.warn(`⚠️ [Tab #${tabId}] [${account.username}] Wait attempt ${attempts} failed: ${waitError.message.substring(0, 50)}`);
                    
                    // Попытка восстановления только каждые 6 попыток (реже)
                    if (attempts % 6 === 0) {
                        try {
                            logger.info(`🔄 [Tab #${tabId}] [${account.username}] Attempting gentle recovery`);
                            
                            // Проверяем что страница еще доступна
                            if (!page.isClosed()) {
                                // Мягкое восстановление без активации
                                await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                                logger.info(`✅ [Tab #${tabId}] [${account.username}] Gentle recovery successful`);
                            }
                        } catch (recoveryError) {
                            logger.warn(`⚠️ [Tab #${tabId}] [${account.username}] Recovery failed: ${recoveryError.message}`);
                            
                            // Если восстановление не удалось, возможно браузер закрыт
                            if (recoveryError.message.includes('Target page, context or browser has been closed')) {
                                break;
                            }
                        }
                    }
                }
            }
            
            // Если дошли сюда - не смогли получить пост за отведенное время
            const totalTime = Date.now() - startTime;
            logger.warn(`⏰ [Tab #${tabId}] [${account.username}] Timeout after ${maxAttempts} attempts (${totalTime}ms) - closing tab`);
            
            // Отправляем лог для сохранения
            if (global.sendLogUpdate) {
                global.sendLogUpdate({
                    level: 'warning',
                    message: `⏰ [Tab #${tabId}] [${account.username}] Timeout after ${Math.round(totalTime/1000)}s - no posts found for @${targetUsername}`
                });
            }
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'warning',
                    message: `⏰ [Tab #${tabId}] ${account.username} timeout after ${Math.round(totalTime/1000)}s - no posts found`
                });
            }
            
        } catch (error) {
            const totalTime = Date.now() - startTime;
            logger.error(`❌ [Tab #${tabId}] [${account.username}] Critical error (${totalTime}ms): ${error.message}`);
            
            // При критических ошибках добавляем IP в блэклист
            if (error.message.includes('timeout') || error.message.includes('net::')) {
                if (account.proxy && account.proxy.server) {
                    const proxyUrl = `http://${account.proxy.username}:${account.proxy.password}@${account.proxy.server}`;
                    await this.proxyManager.addBlacklistedProxy(proxyUrl, 'critical error');
                }
            }
            
        } finally {
            // Гарантированно закрываем вкладку
            if (page && !page.isClosed()) {
                try {
                    await page.close();
                    logger.info(`🗑️ [Tab #${tabId}] [${account.username}] Tab closed in finally block`);
                } catch (closeError) {
                    logger.warn(`⚠️ [Tab #${tabId}] [${account.username}] Failed to close tab: ${closeError.message}`);
                }
            }
        }
    }
}

module.exports = TabParser;