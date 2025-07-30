const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const logger = require('./logger');

class TelegramNotifier {
    constructor() {
        this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
        this.chatId = config.telegram.chatId;
    }

    async sendMessage(message) {
        try {
            await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
            logger.info('Telegram message sent');
        } catch (error) {
            logger.error('Telegram send error:', error);
        }
    }

    async sendPost(post) {
        const message = `
🔥 <b>Новый пост</b>
👤 <b>@${post.username}</b>
📝 ${post.content}
🕐 ${post.timestamp}
🔗 ${post.url}
        `;
        await this.sendMessage(message);
    }

    async sendError(error) {
        const message = `❌ <b>Ошибка парсера:</b>\n${error}`;
        await this.sendMessage(message);
    }
}

module.exports = TelegramNotifier;