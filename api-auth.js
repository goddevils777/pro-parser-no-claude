const axios = require('axios');
const logger = require('./logger');

class TruthSocialAPI {
    constructor() {
        this.baseURL = 'https://truthsocial.com';
        this.token = null;
        this.cookies = null;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };
    }

    async login(email, password) {
        try {
            logger.info('Attempting to login to Truth Social...');
            
            // Сначала получаем CSRF токен
            const csrfResponse = await axios.get(`${this.baseURL}/auth/sign_in`, {
                headers: this.headers
            });
            
            // Извлекаем CSRF токен из HTML
            const csrfMatch = csrfResponse.data.match(/name="csrf-token" content="([^"]+)"/);
            const csrfToken = csrfMatch ? csrfMatch[1] : null;
            
            if (!csrfToken) {
                throw new Error('CSRF token not found');
            }
            
            logger.info('CSRF token obtained');
            
            // Выполняем логин
            const loginResponse = await axios.post(`${this.baseURL}/auth/sign_in`, {
                user: {
                    email: email,
                    password: password
                }
            }, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                    'Referer': `${this.baseURL}/auth/sign_in`
                },
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });
            
            // Извлекаем токен и cookies
            this.token = loginResponse.headers['authorization'] || 
                         loginResponse.data.access_token ||
                         this.extractTokenFromResponse(loginResponse);
            
            this.cookies = loginResponse.headers['set-cookie'];
            
            if (this.token) {
                logger.info('Successfully authenticated!');
                logger.info(`Token: ${this.token.substring(0, 20)}...`);
                return true;
            } else {
                logger.error('No token received');
                return false;
            }
            
        } catch (error) {
            logger.error('Login failed:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            return false;
        }
    }
    
    extractTokenFromResponse(response) {
        // Пытаемся найти токен в разных местах
        const data = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        
        const tokenPatterns = [
            /access_token["\s]*:["\s]*([^"]+)/,
            /token["\s]*:["\s]*([^"]+)/,
            /bearer["\s]*([a-zA-Z0-9_-]+)/i,
            /authorization["\s]*:["\s]*([^"]+)/
        ];
        
        for (const pattern of tokenPatterns) {
            const match = data.match(pattern);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }

    async testAPI() {
        if (!this.token) {
            logger.error('Not authenticated');
            return false;
        }
        
        try {
            const response = await axios.get(`${this.baseURL}/api/v1/accounts/verify_credentials`, {
                headers: {
                    ...this.headers,
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            logger.info('API test successful:', response.data.username);
            return true;
        } catch (error) {
            logger.error('API test failed:', error.message);
            return false;
        }
    }
}

// Тестируем авторизацию
async function testAuth() {
    const api = new TruthSocialAPI();
    
    const success = await api.login('trt24748', 'derogdjjk213Q');
    
    if (success) {
        await api.testAPI();
    }
}

testAuth();

module.exports = TruthSocialAPI;