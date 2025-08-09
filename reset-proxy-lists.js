// reset-proxy-lists.js - Скрипт для обнуления списков прокси

const fs = require('fs-extra');
const path = require('path');

async function resetProxyLists() {
    try {
        console.log('🧹 Resetting proxy lists...');
        
        // Обнуляем белый список
        const whiteListFile = './data/proxy-whitelist.json';
        if (await fs.pathExists(whiteListFile)) {
            await fs.writeJson(whiteListFile, []);
            console.log('✅ Whitelist cleared');
        }
        
        // Обнуляем черный список
        const blackListFile = './data/proxy-blacklist.json';
        if (await fs.pathExists(blackListFile)) {
            await fs.writeJson(blackListFile, []);
            console.log('✅ Blacklist cleared');
        }
        
        // Обнуляем статистику прокси
        const statsFile = './data/proxy-stats.json';
        if (await fs.pathExists(statsFile)) {
            await fs.writeJson(statsFile, {});
            console.log('✅ Proxy stats cleared');
        }
        
        console.log('🎯 All proxy lists reset! Fresh start ready.');
        console.log('📝 Restart the server to apply changes.');
        
    } catch (error) {
        console.error('❌ Error resetting proxy lists:', error.message);
    }
}

// Запускаем сброс
resetProxyLists();