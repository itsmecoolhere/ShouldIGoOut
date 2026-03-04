require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const fs = require('fs');
const path = require('path');


const app = express();
const PORT = process.env.PORT || 5000;
const CACHE_FILE = path.join(__dirname, 'geocoding_cache.json');

// khởi tạo cache
let geocodeCache = {
    locations: {}, // name -> {lat, lon}
    ids: {},       // placeId -> {lat, lon}
    autocomplete: {} // text -> result
};

if (fs.existsSync(CACHE_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        // merge với mặc định để đảm bảo đủ fields
        geocodeCache.locations = loaded.locations || {};
        geocodeCache.ids = loaded.ids || {};
        geocodeCache.autocomplete = loaded.autocomplete || {};
    } catch (e) {
        console.error("Cache load error:", e.message);
    }
}

const saveCache = () => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(geocodeCache, null, 2));
};

app.use(cors());
app.use(express.json());

// lấy tọa độ từ tên thành phố
async function getCoords(city) {
    const geoRes = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
        params: { name: city, count: 1, language: 'vi', format: 'json' }
    });
    if (!geoRes.data.results || geoRes.data.results.length === 0) {
        throw new Error("City not found");
    }
    return geoRes.data.results[0];
}

// api thời tiết (open-meteo)
app.get('/api/weather', async (req, res) => {
    let { city, lat, lon, name } = req.query;
    const requestTime = new Date().toLocaleTimeString('vi-VN');

    console.log(`\n[${requestTime}] [Weather Request]:`, { city, lat, lon, name, isAuto: req.query.isAuto });

    try {
        // mặc định: tp.hcm
        const DEFAULT_LAT = 10.762622;
        const DEFAULT_LON = 106.660172;
        const DEFAULT_NAME = "Thành phố Hồ Chí Minh";

        let cityName = name || DEFAULT_NAME;
        let country = "VN";

        if (city) {
            console.log(`[${requestTime}] [Geocoding city]: "${city}"`);
            const geo = await getCoords(city);
            lat = geo.latitude;
            lon = geo.longitude;
            cityName = geo.name;
            country = geo.country;
            console.log(`[${requestTime}] [Found]: ${cityName} (${lat}, ${lon}) - ${country}`);
        } else if (lat && lon) {
            console.log(`[${requestTime}] [Coords provided]: (${lat}, ${lon})`);

            try {
                // Sử dụng Nominatim (OpenStreetMap) để lấy địa chỉ chi tiết hơn tại Việt Nam
                const reverseGeo = await axios.get(`https://nominatim.openstreetmap.org/reverse`, {
                    params: {
                        lat: lat,
                        lon: lon,
                        format: 'json',
                        addressdetails: 1,
                        'accept-language': 'vi'
                    },
                    headers: {
                        'User-Agent': 'ShouldIGoOut-App' // nominatim cần user-agent
                    }
                });

                const addr = reverseGeo.data.address;
                // ưu tiên: phường/xã -> quận/huyện -> tp/tỉnh
                const detail = addr.suburb || addr.quarter || addr.neighbourhood || addr.city_district || addr.district || addr.city || addr.town || "";

                if (req.query.isAuto === 'true') {
                    cityName = detail ? `Vị trí hiện tại, ${detail}` : "Vị trí hiện tại";
                } else {
                    cityName = name || detail || "Địa điểm không xác định";
                }
                console.log(`[${requestTime}] [Reverse geocoded]: ${cityName}`);
            } catch (e) {
                console.error(`[${requestTime}] [Reverse Geo Error]:`, e.message);
                cityName = (req.query.isAuto === 'true') ? "Vị trí hiện tại" : (name || "Địa điểm không xác định");
            }
            country = "";
        } else {
            // ko tham số, dùng mặc định
            console.log(`[${requestTime}] [Using default]: ${DEFAULT_NAME}`);
            lat = DEFAULT_LAT;
            lon = DEFAULT_LON;
        }

        console.log(`[${requestTime}] [Fetching weather]: ${cityName} (${lat}, ${lon})`);

        const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
            params: {
                latitude: lat,
                longitude: lon,
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
                hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max',
                timezone: 'auto',
                forecast_days: 7
            }
        });

        console.log(`[${requestTime}] [Weather received]: ${cityName}`);


        res.json({
            ...response.data,
            city: { name: cityName, country: country }
        });
    } catch (error) {
        console.error(`[${requestTime}] [Error]:`, error.message, '| Query:', { city, lat, lon, name });
        res.status(400).json({ cod: "400", message: error.message });
    }
});

// api chất lượng không khí (open-meteo, free)
app.get('/api/air-quality', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

    try {
        const response = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
            params: {
                latitude: lat,
                longitude: lon,
                current: 'us_aqi,pm10,pm2_5',
                hourly: 'us_aqi,pm2_5,pm10',
                timezone: 'auto',
                forecast_days: 1
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('AQI error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// api gợi ý tìm kiếm (openmap)
app.get('/api/autocomplete', async (req, res) => {
    const { text, lat, lon } = req.query;
    const apiKey = process.env.OPENMAP_API_KEY;
    if (!text) return res.json({ features: [] });

    const cacheKey = `${text.toLowerCase()}_${lat || 0}_${lon || 0}`;
    if (geocodeCache.autocomplete[cacheKey] && (Date.now() - (geocodeCache.autocomplete[cacheKey].ts || 0) < 3600000)) {
        return res.json(geocodeCache.autocomplete[cacheKey].data);
    }

    try {
        const params = { text, apikey: apiKey };
        if (lat && lon) {
            params['focus.point.lat'] = lat;
            params['focus.point.lon'] = lon;
        }
        const response = await axios.get('https://mapapis.openmap.vn/v1/autocomplete', {
            params,
            timeout: 5000
        });

        // lưu cache 1h
        geocodeCache.autocomplete[cacheKey] = {
            data: response.data,
            ts: Date.now()
        };
        // lưu trong RAM, ko ghi file
        // saveCache(); 

        res.json(response.data);
    } catch (error) {
        if (error.response?.status === 429) {
            console.error('Autocomplete: Rate limited (429)');
            return res.status(429).json({ error: 'Too many requests', features: [] });
        }
        console.error('Autocomplete error:', error.message);
        res.json({ features: [] });
    }
});

// api chi tiết địa điểm (openmap)
app.get('/api/place', async (req, res) => {
    const { id } = req.query;
    const apiKey = process.env.OPENMAP_API_KEY;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // check cache
    if (geocodeCache.ids[id]) {
        console.log(`  [CACHE HIT] ID: ${id}`);
        return res.json({ features: [{ geometry: { coordinates: [geocodeCache.ids[id].lon, geocodeCache.ids[id].lat] } }] });
    }

    try {
        const response = await axios.get('https://mapapis.openmap.vn/v1/place', {
            params: { id, apikey: apiKey }
        });
        const feature = response.data.features?.[0];
        if (feature?.geometry?.coordinates) {
            const [lon, lat] = feature.geometry.coordinates;
            geocodeCache.ids[id] = { lat, lon };
            saveCache();
        }
        res.json(response.data);
    } catch (error) {
        console.error('Place detail error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// api geocode hàng loạt cho import ics
app.post('/api/geocode-batch', async (req, res) => {
    const { locations } = req.body;
    const apiKey = process.env.OPENMAP_API_KEY;
    if (!locations || !Array.isArray(locations)) return res.json({});

    const results = {};
    const BATCH_SIZE = 3;
    const DELAY_MS = 500;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const geocodeOne = async (loc) => {
        // cache theo tên
        if (geocodeCache.locations[loc]) {
            console.log(`  [CACHE HIT] Name: ${loc}`);
            results[loc] = geocodeCache.locations[loc];
            return;
        }

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const autoRes = await axios.get('https://mapapis.openmap.vn/v1/autocomplete', {
                    params: { text: loc, apikey: apiKey },
                    timeout: 5000
                });
                const feature = autoRes.data.features?.[0];
                const placeId = feature?.properties?.id;

                if (placeId) {
                    // cache theo id
                    if (geocodeCache.ids[placeId]) {
                        console.log(`  [CACHE HIT] ID: ${placeId} (for ${loc})`);
                        results[loc] = geocodeCache.ids[placeId];
                        geocodeCache.locations[loc] = geocodeCache.ids[placeId];
                        saveCache();
                        return;
                    }

                    const placeRes = await axios.get('https://mapapis.openmap.vn/v1/place', {
                        params: { id: placeId, apikey: apiKey },
                        timeout: 5000
                    });
                    const placeFeature = placeRes.data.features?.[0];
                    if (placeFeature?.geometry?.coordinates) {
                        const [lon, lat] = placeFeature.geometry.coordinates;
                        const coords = { lat, lon };
                        results[loc] = coords;
                        geocodeCache.locations[loc] = coords;
                        geocodeCache.ids[placeId] = coords;
                        saveCache();
                        console.log(`  [OK] ${loc} -> (${lat}, ${lon})`);
                        return;
                    }
                }
                console.log(`  [WARN] ${loc} -> no coords found`);
                return;
            } catch (err) {
                if (err.response?.status === 429 && attempt === 0) {
                    console.log(`  [WAIT] Rate limited for: ${loc}, retrying in 2s...`);
                    await sleep(2000);
                    continue;
                }
                console.warn(`  [ERROR] ${loc} -> ${err.message}`);
                return;
            }
        }
    };

    console.log(`\n[Batch geocode]: ${locations.length} locations`);

    // xử lý theo lô
    for (let i = 0; i < locations.length; i += BATCH_SIZE) {
        const batch = locations.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(geocodeOne));
        if (i + BATCH_SIZE < locations.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`[Batch Done]: Geocoded ${Object.keys(results).length}/${locations.length} locations\n`);
    res.json(results);
});

// api phân tích ai (groq)
const AI_MODEL = 'llama-3.1-8b-instant';

app.post('/api/analyze-day', async (req, res) => {
    const { date, weatherData, eventsList } = req.body;
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Backend is missing GROQ_API_KEY' });
    }
    if (!date || !weatherData) {
        return res.status(400).json({ error: 'Missing date or weatherData' });
    }

    let promptText = `Bạn là một trợ lý ảo thông minh chuyên phân tích thời tiết và lịch trình trong ngày để đưa ra lời khuyên hữu ích cho người dùng ở Việt Nam. Trả lời bằng tiếng Việt ngắn gọn, thân thiện.

Thông tin ngày ${date}:
- Nơi ở: ${weatherData.city || 'Thành phố Hồ Chí Minh'}
- Nhiệt độ: ${weatherData.temp}°C (cảm giác ${weatherData.feels_like}°C)
- Tình trạng: ${weatherData.weather.description}
- Khả năng mưa: ${Math.round(weatherData.pop * 100)}%
- Gió: ${weatherData.wind_speed} km/h
`;

    if (eventsList && eventsList.length > 0) {
        promptText += `\nLịch trình hôm nay:\n${eventsList.map(e => `- ${new Date(e.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}: ${e.title} tại ${e.location || 'không rõ'}`).join('\n')}\n`;
    } else {
        promptText += `\nHôm nay chưa có lịch trình cụ thể.\n`;
    }

    promptText += `\nTrả về JSON thuần túy (không markdown):\n{
  "summary": "Tóm tắt ngắn gọn về thời tiết và lời khuyên chính cho lịch trình",
  "preparations": ["vật dụng 1", "vật dụng 2"]
}`;

    try {
        console.log(`\n[AI Analysis]: Model=${AI_MODEL}, Date=${date}`);
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: AI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant. Only output valid JSON objects, no markdown wrappers.' },
                    { role: 'user', content: promptText }
                ],
                temperature: 0.5,
                max_tokens: 1024,
                response_format: { type: "json_object" }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        let aiOutput = response.data.choices[0].message.content;
        console.log(`[AI Analysis Raw]:`, aiOutput);

        // trích xuất json từ output ai
        const jsonMatch = aiOutput.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("AI did not return a valid JSON object block");
        }

        const cleanJson = jsonMatch[0];

        try {
            const parsed = JSON.parse(cleanJson);
            console.log(`[AI Analysis]: Parsed Successfully!`);
            res.json(parsed);
        } catch (parseError) {
            console.error('[AI Output Parse Error]:', parseError.message);
            console.error('[Problematic String]:', cleanJson);
            throw new Error("Invalid JSON format from AI");
        }

    } catch (error) {
        console.error('[AI Analysis Error]:', error.response?.data || error.message);
        res.status(500).json({ error: error.message || 'Failed to generate AI analysis' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend is running on http://localhost:${PORT}`);
});
