const axios = require('axios');
const logger = require('./logger');

class TruthSocialAPIParser {
    constructor() {
        this.baseURL = 'https://truthsocial.com';
        this.token = 'BlChfq4xZWeEvTEPFYD1EmeY4iYLsitAiNh3VYP8g1o';
        this.headers = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'ru,en-US;q=0.9,en;q=0.8,uk;q=0.7',
            'authorization': `Bearer ${this.token}`,
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'referer': 'https://truthsocial.com/@realDonaldTrump.rss'
        };
        this.cookies = 'mp_15c0cd079bcfa80cd935f3a1b8606b48_mixpanel=%7B%22distinct_id%22%3A%20%22trt24748%22%2C%22%24device_id%22%3A%20%221985732619a169-02662bb05a8475-17525636-1a6f94-1985732619b9a2%22%2C%22%24initial_referrer%22%3A%20%22https%3A%2F%2Ftruthsocial.com%2F%3F__cf_chl_tk%3D3ApyAOWfM8MjqDq80yTYOM5Yv5K.RekodJyZcFHYc0M-1753809567-1.0.1.1-CmJeNzkN9fPvpxj5WHsSUZeeyoCzDZhbBfhjiKI7HOE%22%2C%22%24initial_referring_domain%22%3A%20%22truthsocial.com%22%2C%22%24user_id%22%3A%20%22trt24748%22%7D; _tq_id.TV-5427368145-1.4081=11513e2f530402cb.1753809577.0.1753847303..; cf_clearance=Degea_8yN0FWvPMoR2Yu2FaCpSIJ7w1xn95Yk70f.tA-1753847301-1.2.1.1-oLjrL.3l6jEdic5EY8JHz9Rq5wroG40URnylidsatmu1vDCxngtIn0rB9ffhnqGaKldHroEBV8NzRKqAvqC_K8ypANdgA.qxCTieNyNpbG0U9chiCVPPzUwRGlBrcF5uSTXemRXIsh3CD8incrASPgmv2qGwiP3YHUwblbk.75YNNSJhU1NQA2L4O_VpQzcXHIP22qnW2606_WZcVw4XVPRg9zD6lB9v2kVUuhVPqvo; _mastodon_session=1cxT+Sa/J7FA+DChh5zk/rOBcRtsO+syldZoxcZWofAD2Ye+g5RY5DQSNsP7Gm/CX7Hyq979TIvQ0XRmygXzxnbpSjwyu21cme7o5Hcdz3DcBpT2SS6usJBA9DlzTSsqtTkVemurMAfU68ajWu4zjR991hmkxroTO8oOdxDYW4ZDveCnySzTI6/Wg0E+dTPvXwfmxH+D+Yt2zWuft9NAlOGvcALxdh3BuQScQ8Gq232XupysaLLi2xCWBGKV--WszKf5bRU+NSX8pC--ZEBOQaSUbpNQTOJqozFFIg==';
    }

    async testConnection() {
        try {
            const response = await axios.get(`${this.baseURL}/api/v1/accounts/verify_credentials`, {
                headers: {
                    ...this.headers,
                    'Cookie': this.cookies
                }
            });
            
            logger.info('✅ API connection successful!', {
                username: response.data.username,
                id: response.data.id
            });
            return true;
        } catch (error) {
            logger.error('❌ API connection failed:', error.response?.status, error.response?.statusText);
            return false;
        }
    }

    

    async getUserId(username) {
        try {
            const response = await axios.get(`${this.baseURL}/api/v1/accounts/lookup?acct=${username}`, {
                headers: {
                    ...this.headers,
                    'Cookie': this.cookies
                }
            });
            
            return response.data.id;
        } catch (error) {
            logger.error(`Failed to get user ID for ${username}:`, error.message);
            return null;
        }
    }

    async getUserPosts(username, limit = 5) {
        const startTime = Date.now();
        
        try {
            const userId = await this.getUserId(username);
            if (!userId) return null;

            const response = await axios.get(`${this.baseURL}/api/v1/accounts/${userId}/statuses`, {
                params: { limit },
                headers: {
                    ...this.headers,
                    'Cookie': this.cookies
                }
            });

            const parseTime = Date.now() - startTime;
            logger.info(`✅ API parse success for ${username}: ${parseTime}ms`);

            return response.data.map(post => ({
                id: post.id,
                content: post.content.replace(/<[^>]*>/g, ''), // Убираем HTML теги
                created_at: post.created_at,
                url: post.url,
                username: username
            }));

        } catch (error) {
            const parseTime = Date.now() - startTime;
            logger.error(`❌ API parse error for ${username} (${parseTime}ms):`, error.message);
            return null;
        }
    }

    async parseUser(username) {
    const startTime = Date.now();
    
    try {
        // Используем прямой ID для Trump'а (уже знаем из браузера)
        const userId = username === 'realDonaldTrump' ? '107780257626128497' : await this.getUserId(username);
        if (!userId) return null;

        const response = await axios.get(`${this.baseURL}/api/v1/accounts/${userId}/statuses`, {
            params: { limit: 1 },
            headers: {
                ...this.headers,
                'Cookie': this.cookies
            }
        });

        const parseTime = Date.now() - startTime;
        
        if (response.data && response.data.length > 0) {
            const post = response.data[0];
            const result = {
                id: post.id,
                content: post.content.replace(/<[^>]*>/g, '').trim(),
                created_at: post.created_at,
                url: post.url,
                username: username
            };
            
            logger.info(`✅ Ultra-fast API parse for ${username}: ${parseTime}ms`);
            return result;
        }
        
        logger.info(`⚪ No posts for ${username}: ${parseTime}ms`);
        return null;

    } catch (error) {
        const parseTime = Date.now() - startTime;
        logger.error(`❌ API parse error for ${username} (${parseTime}ms):`, error.response?.status || error.message);
        return null;
    }
}

}

// Быстрый тест
// Замени эту функцию:
async function testAPI() {
    const parser = new TruthSocialAPIParser();
    
    console.log('Testing minimal connection...');
    
    try {
        const response = await axios.get(`${parser.baseURL}/api/v1/accounts/verify_credentials`, {
            headers: {
                'authorization': `Bearer ${parser.token}`,
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Cookie': 'cf_clearance=Degea_8yN0FWvPMoR2Yu2FaCpSIJ7w1xn95Yk70f.tA-1753847301-1.2.1.1-oLjrL.3l6jEdic5EY8JHz9Rq5wroG40URnylidsatmu1vDCxngtIn0rB9ffhnqGaKldHroEBV8NzRKqAvqC_K8ypANdgA.qxCTieNyNpbG0U9chiCVPPzUwRGlBrcF5uSTXemRXIsh3CD8incrASPgmv2qGwiP3YHUwblbk.75YNNSJhU1NQA2L4O_VpQzcXHIP22qnW2606_WZcVw4XVPRg9zD6lB9v2kVUuhVPqvo'
            }
        });
        
        console.log('✅ Minimal test successful!', response.data.username);
        
        // Тест получения постов Trump'а
        const postsResponse = await axios.get(`${parser.baseURL}/api/v1/accounts/107780257626128497/statuses?limit=1`, {
            headers: {
                'authorization': `Bearer ${parser.token}`,
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Cookie': 'cf_clearance=Degea_8yN0FWvPMoR2Yu2FaCpSIJ7w1xn95Yk70f.tA-1753847301-1.2.1.1-oLjrL.3l6jEdic5EY8JHz9Rq5wroG40URnylidsatmu1vDCxngtIn0rB9ffhnqGaKldHroEBV8NzRKqAvqC_K8ypANdgA.qxCTieNyNpbG0U9chiCVPPzUwRGlBrcF5uSQL8incrASPgmv2qGwiP3YHUwblbk.75YNNSJhU1NQA2L4O_VpQzcXHIP22qnW2606_WZcVw4XVPRg9zD6lB9v2kVUuhVPqvo'
            }
        });
        
        console.log('✅ Latest Trump post:', postsResponse.data[0]?.content?.substring(0, 100));
        
    } catch (error) {
        console.log('❌ Test failed:', error.response?.status, error.response?.statusText);
    }
}





testAPI();


module.exports = TruthSocialAPIParser;