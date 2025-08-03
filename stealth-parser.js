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
        this.tabParser = new TabParser(this.proxyManager, this.timingTracker);
        
        // Активные интервалы мониторинга
        this.activeIntervals = new Map(); // username -> interval ID
    }

    // =====================================
    // ИНИЦИАЛИЗАЦИЯ
    // =====================================

    async init() {
        logger.info('Account management parser ready');
        
        // Загружаем список авторизованных аккаунтов при старте
        await this.accountManager.loadAuthorizedAccounts();
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

    // =====================================
    // УПРАВЛЕНИЕ МОНИТОРИНГОМ
    // =====================================

    // Запуск мониторинга профилей
    async startMonitoring(profiles) {
        // Получаем авторизованные аккаунты
        const authorizedAccounts = this.accountManager.getAuthorizedAccounts();
        const requiredAccounts = profiles.length * 3; // ВРЕМЕННО: 3 аккаунта на профиль для тестов

        if (authorizedAccounts.length === 0) {
            const message = 'No authorized accounts available. Please authorize at least one account first.';
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `❌ ${message}`
                });
            }
            
            throw new Error(message);
        }

        if (authorizedAccounts.length < requiredAccounts) {
            const message = `❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles.\n\n📋 TEST MODE: 1 profile = 3 accounts (temporary for testing)\n\n📊 Currently have: ${authorizedAccounts.length} authorized accounts\n📊 Need to authorize: ${requiredAccounts - authorizedAccounts.length} more accounts\n\n💡 Please authorize more accounts before starting monitoring.`;
            
            logger.error(`❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles (3 accounts per profile). Currently have ${authorizedAccounts.length} accounts.`);
            
            if (global.io) {
                global.io.emit('log', {
                    level: 'error',
                    message: `❌ INSUFFICIENT ACCOUNTS: Need ${requiredAccounts} accounts for ${profiles.length} profiles`
                });
                
                global.io.emit('log', {
                    level: 'info',
                    message: `📋 TEST MODE: 1 profile = 3 accounts (temporary for testing)`
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

        logger.info(`🚀 Starting TEST monitoring ${profiles.length} profiles with ${authorizedAccounts.length} authorized accounts (3 browsers per profile, 2 tabs max)`);

        // Разделяем аккаунты по профилям (по 3 аккаунта на профиль)
        let accountIndex = 0;

        for (const profile of profiles) {
            try {
                // Берем 3 аккаунта для этого профиля
                const profileAccounts = authorizedAccounts.slice(accountIndex, accountIndex + 3);
                accountIndex += 3;

                if (profileAccounts.length < 3) {
                    logger.warn(`⚠️ Only ${profileAccounts.length} accounts available for @${profile.username}`);
                }

                // Запускаем тестовый парсинг для этого профиля
                const interval = this.tabParser.startParallelParsing(profile.username, profileAccounts);
                this.activeIntervals.set(profile.username, interval);

                logger.info(`✅ Started TEST monitoring @${profile.username} with ${profileAccounts.length} accounts`);

                if (global.io) {
                    global.io.emit('log', {
                        level: 'success',
                        message: `✅ @${profile.username} TEST mode: ${profileAccounts.length} browsers × 2 tabs max`
                    });
                }

            } catch (error) {
                logger.error(`❌ Failed to setup monitoring for @${profile.username}: ${error.message}`);
            }
        }

        if (global.io) {
            global.io.emit('log', {
                level: 'success',
                message: `🎯 TEST monitoring started: ${profiles.length} profiles with ${authorizedAccounts.length} accounts`
            });
            
            global.io.emit('log', {
                level: 'info',
                message: `⚡ TEST Speed: 3 browsers per profile, 2 tabs max per browser, 5 second intervals`
            });
        }

        logger.info(`🎯 All profiles ready for TEST monitoring!`);
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