// stealth-parser.js - Основной файл парсера
const logger = require('./logger');
const ProxyManager = require('./proxy-manager');
const AccountManager = require('./account-manager');
const PostTimingTracker = require('./post-timing-tracker');
const TabParser = require('./tab-parser');

class StealthParser {
    constructor() {
        // Инициализируем все модули
        this.proxyManager = new ProxyManager('./port_list.txt');
        this.accountManager = new AccountManager(this.proxyManager);
        this.timingTracker = new PostTimingTracker();
        this.tabParser = new TabParser(this.proxyManager, this.timingTracker, this.accountManager);
        
        // Активные интервалы мониторинга
        this.activeIntervals = new Map(); // username -> interval ID
    }

    // =====================================
    // ИНИЦИАЛИЗАЦИЯ
    // =====================================

    async init() {
        logger.info('🔍 STEALTH PARSER INIT STARTED');
        logger.info('Account management parser ready');
        
        // Добавить отладку
        logger.info('🔍 About to call loadAuthorizedAccounts...');
        await this.accountManager.loadAuthorizedAccounts();
        logger.info('🔍 loadAuthorizedAccounts completed');
    }

    // =====================================
    // ПРОКСИ МЕТОДЫ ДЛЯ ACCOUNT MANAGER
    // =====================================

    async startAccountAuthorization(username) {
        return await this.accountManager.startAccountAuthorization(username);
    }

    async confirmAccountAuthorization(username) {
        return await this.accountManager.confirmAccountAuthorization(username);
    }

    async removeAccount(username) {
        return await this.accountManager.removeAccount(username);
    }

    getAccountsList() {
        return this.accountManager.getAccountsList();
    }

    // =====================================
    // ПРОКСИ МЕТОДЫ ДЛЯ TIMING TRACKER
    // =====================================

    getPostTimingStats() {
        return this.timingTracker.getPostTimingStats();
    }

    // =====================================
    // ПРОКСИ МЕТОДЫ ДЛЯ TAB PARSER
    // =====================================

    getTabsStats() {
        return this.tabParser.getTabsStats();
    }

    // Восстановление сессий для офлайн аккаунтов
    async restoreOfflineAccountSessions() {
        logger.info(`🔄 Checking for offline accounts to restore...`);
        
        let restored = 0;
        for (const [username, account] of this.accountManager.authorizedAccounts) {
            if (account.status === 'offline') {
                const sessionPath = `./data/sessions/${username}-session.json`;
                
                if (await require('fs-extra').pathExists(sessionPath)) {
                    try {
                        logger.info(`🔄 Restoring session for ${username}...`);
                        
                        // Запускаем новый браузер с сохраненной сессией
                        const browserData = await this.accountManager.findWorkingIP();
                        
                        // Восстанавливаем сессию
                        await this.accountManager.restoreAccountSession(username, browserData.context, browserData.page);
                        
                        // Обновляем данные аккаунта
                        account.browser = browserData.browser;
                        account.context = browserData.context;
                        account.page = browserData.page;
                        account.proxy = browserData.proxy;
                        account.proxyUrl = browserData.proxyUrl;
                        account.status = 'authorized';
                        
                        // Отмечаем IP как используемый
                        if (browserData.proxyUrl) {
                            this.accountManager.proxyManager.markProxyAsUsed(browserData.proxyUrl);
                        }
                        
                        restored++;
                        logger.info(`✅ Session restored for ${username} with IP: ${browserData.proxy?.server}`);
                        
                    } catch (error) {
                        logger.warn(`❌ Failed to restore session for ${username}: ${error.message}`);
                    }
                } else {
                    logger.info(`💡 No saved session found for ${username}`);
                }
            }
        }
        
        if (restored > 0) {
            logger.info(`🎯 Successfully restored ${restored} account sessions`);
        } else {
            logger.info(`💡 No offline accounts to restore`);
        }
        
        return restored;
    }

    // =====================================
    // УПРАВЛЕНИЕ МОНИТОРИНГОМ
    // =====================================

    // Запуск мониторинга профилей
    async startMonitoring(profiles) {
        // Сначала восстанавливаем сессии для офлайн аккаунтов и ЖДЕМ завершения
        logger.info(`🔄 Checking for offline accounts to restore...`);
        const restoredCount = await this.restoreOfflineAccountSessions();

        if (restoredCount > 0) {
            logger.info(`⏳ Waiting 5 seconds for restored sessions to stabilize...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Теперь получаем авторизованные аккаунты
       const allAccounts = this.accountManager.getAccountsList();
const authorizedAccounts = allAccounts.filter(acc => acc.status === 'authorized' || acc.status === 'offline');

        if (global.io) {
            global.io.emit('log', {
                level: 'info',
                message: `📊 Found ${authorizedAccounts.length} authorized accounts ready for parsing`
            });
        }

        const requiredAccounts = profiles.length * 7; // 7 аккаунтов на профиль

        if (authorizedAccounts.length === 0) {
            const message = 'No accounts available (authorized or offline). Please add accounts first.';
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `❌ ${message}`
                });
            }
            
            throw new Error(message);
        }

        if (authorizedAccounts.length < requiredAccounts) {
            const message = `❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles.\n\n📋 Current: 1 profile = 7 accounts\n\n📊 Currently have: ${authorizedAccounts.length} authorized accounts\n📊 Need to authorize: ${requiredAccounts - authorizedAccounts.length} more accounts\n\n💡 Please authorize more accounts before starting monitoring.`;
            
            logger.error(`❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles (7 accounts per profile). Currently have ${authorizedAccounts.length} accounts.`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles`
                });
                
                global.io.emit('log', {
                    level: 'info',
                    message: `📋 Current: 1 profile = 7 accounts`
                });
                
                global.io.emit('log', {
                    level: 'info',
                    message: `📊 Currently have: ${authorizedAccounts.length} authorized accounts`
                });
                
                global.io.emit('log', {
                    level: 'info', 
                    message: `📊 Need to authorize: ${requiredAccounts - authorizedAccounts.length} more accounts`
                });
                
                global.io.emit('log', {
                    level: 'warning',
                    message: `💡 Please authorize ${requiredAccounts - authorizedAccounts.length} more accounts before starting monitoring`
                });
            }
            
            throw new Error(message);
        }

        logger.info(`🚀 Starting monitoring ${profiles.length} profiles with ${authorizedAccounts.length} authorized accounts (7 browsers per profile, 2 tabs max)`);

        // Разделяем аккаунты по профилям (по 7 аккаунтов на профиль)
        let accountIndex = 0;

        for (const profile of profiles) {
            try {
                // Берем 7 аккаунтов для этого профиля
                const profileAccounts = authorizedAccounts.slice(accountIndex, accountIndex + 7);
                accountIndex += 7;

                if (profileAccounts.length < 7) {
                    const errorMessage = `❌ INSUFFICIENT ACCOUNTS for @${profile.username}: Need exactly 7 accounts, but only ${profileAccounts.length} provided. Skipping this profile.`;
                    logger.error(errorMessage);
                    
                    if (global.io) {
                        global.io.emit('log', {
                            level: 'error',
                            message: errorMessage
                        });
                    }
                    continue; // Пропускаем этот профиль
                }

                // Запускаем парсинг для этого профиля
                const interval = this.tabParser.startParallelParsing(profile.username, profileAccounts);
                this.activeIntervals.set(profile.username, interval);

                logger.info(`✅ Started monitoring @${profile.username} with ${profileAccounts.length} accounts`);

                if (global.io) {
                    global.io.emit('log', {
                        level: 'success',
                        message: `✅ @${profile.username}: ${profileAccounts.length} browsers × 2 tabs max`
                    });
                }

            } catch (error) {
                logger.error(`❌ Failed to setup monitoring for @${profile.username}: ${error.message}`);
            }
        }

        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `🎯 Monitoring started: ${profiles.length} profiles with ${authorizedAccounts.length} accounts`
            });
            
            global.io.emit('log', {
                level: 'info',
                message: `⚡ Speed: 7 browsers per profile, 2 tabs max per browser, 5 second intervals`
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

        // Закрываем все авторизованные браузеры через AccountManager
        for (const [username, account] of this.accountManager.authorizedAccounts) {
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
}

module.exports = StealthParser;