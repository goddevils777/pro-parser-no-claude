const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const config = require('./config');
const logger = require('./logger');

class TruthSocialParser {
    constructor() {
        this.lastPostIds = new Map();
        this.token = 'BlChfq4xZWeEvTEPFYD1EmeY4iYLsitAiNh3VYP8g1o';
        this.baseURL = 'https://truthsocial.com/api/v1';
        this.proxies = [
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a97ec9ff:9tHcGyQC4WjkcKgI@190.2.137.56:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a97f0b7a:9tHcGyQC4WjkcKgI@109.236.90.205:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a97f3192:9tHcGyQC4WjkcKgI@109.236.94.16:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a98014e0:9tHcGyQC4WjkcKgI@93.190.142.210:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9803825:9tHcGyQC4WjkcKgI@109.236.94.16:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9805968:9tHcGyQC4WjkcKgI@190.2.151.110:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9807ccf:9tHcGyQC4WjkcKgI@175.110.115.169:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a980a165:9tHcGyQC4WjkcKgI@62.112.9.140:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a980c60e:9tHcGyQC4WjkcKgI@212.8.249.134:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a980e935:9tHcGyQC4WjkcKgI@185.132.133.7:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9810cdf:9tHcGyQC4WjkcKgI@62.112.11.28:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9812fa5:9tHcGyQC4WjkcKgI@190.2.137.5:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a98154c9:9tHcGyQC4WjkcKgI@190.2.137.5:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9817a8c:9tHcGyQC4WjkcKgI@109.236.90.205:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9819e1b:9tHcGyQC4WjkcKgI@190.2.155.93:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a981c1e2:9tHcGyQC4WjkcKgI@93.190.142.210:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a981ea63:9tHcGyQC4WjkcKgI@212.8.249.134:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9820f78:9tHcGyQC4WjkcKgI@109.236.94.16:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9823555:9tHcGyQC4WjkcKgI@190.2.130.11:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9825973:9tHcGyQC4WjkcKgI@190.2.137.5:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9827aba:9tHcGyQC4WjkcKgI@91.232.105.85:9999',
            'http://gnvi6dmlah-corp.mobile.res-country-US-state-6254928-city-4744870-hold-session-session-687e4a9829ca8:9tHcGyQC4WjkcKgI@217.23.2.7:9999'
        ];
        this.currentProxyIndex = 0;
        this.requestCount = 0;
        this.maxRequestsPerProxy = 20;
    }

    async init() {
        logger.info('Proxy API Parser initialized');
    }

    getNextProxy() {
        if (this.requestCount >= this.maxRequestsPerProxy) {
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
            this.requestCount = 0;
            logger.info(`Switched to proxy ${this.currentProxyIndex + 1}`);
        }
        this.requestCount++;
        return this.proxies[this.currentProxyIndex];
    }

    async makeRequest(url, params = {}) {
        const proxy = this.getNextProxy();
        const agent = new HttpsProxyAgent(proxy);
        
        try {
            const response = await axios.get(url, {
                params,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.token}`,
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                },
                httpsAgent: agent,
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            logger.error(`Request failed with proxy ${this.currentProxyIndex + 1}:`, {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
                proxy: this.proxies[this.currentProxyIndex].split('@')[1], // Показывает только IP:PORT
                url: url
            });
            throw error;
        }
    }

    async getUserId(username) {
        try {
            const data = await this.makeRequest(`${this.baseURL}/accounts/lookup`, { acct: username });
            return data.id;
        } catch (error) {
            logger.error(`Get user ID error for ${username}:`, error.message);
            return null;
        }
    }

    async parseLatestPost(username) {
        try {
            const userId = await this.getUserId(username);
            if (!userId) return null;

            const posts = await this.makeRequest(`${this.baseURL}/accounts/${userId}/statuses`, { limit: 1 });
            if (posts.length === 0) return null;

            const post = posts[0];
            return {
                id: post.id,
                content: post.content.replace(/<[^>]*>/g, ''),
                timestamp: post.created_at,
                url: post.url
            };
        } catch (error) {
            logger.error(`Parse error for ${username}:`, error.message);
            return null;
        }
    }

    async close() {
        logger.info('Proxy API Parser closed');
    }
}

module.exports = TruthSocialParser;