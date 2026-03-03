export interface WeatherData {
    city: string;
    country: string;
    list: WeatherForecast[];
    hourly: WeatherForecast[];
}

export interface WeatherForecast {
    dt: number;
    temp: number;
    feels_like: number;
    humidity: number;
    wind_speed: number;
    weather: {
        main: string;
        description: string;
        icon: string;
    };
    pop: number;
    uvi?: number;
}

export interface GoOutAnalysis {
    shouldGo: "safe" | "caution" | "avoid";
    reason: string;
    essentials: string[];
    comfortScore: number;
}

const BACKEND_URL = "http://localhost:5000/api/weather";

// map wmo code (open-meteo) sang text kiểu openweather
const mapWMOCode = (code: number) => {
    if (code === 0) return { main: "Clear", description: "Trời quang", icon: "01d" };
    if (code >= 1 && code <= 3) return { main: "Clouds", description: "Nhiều mây", icon: "03d" };
    if (code >= 45 && code <= 48) return { main: "Fog", description: "Sương mù", icon: "50d" };
    if (code >= 51 && code <= 67) return { main: "Rain", description: "Mưa", icon: "10d" };
    if (code >= 80 && code <= 82) return { main: "Rain", description: "Mưa phùn", icon: "09d" };
    if (code >= 95) return { main: "Thunderstorm", description: "Bão", icon: "11d" };
    return { main: "Clouds", description: "Nhiều mây", icon: "03d" };
};

const processWeatherData = (data: any): WeatherData | null => {
    if (data.cod && (data.cod !== 200 && data.cod !== "200")) {
        console.error(`Lỗi từ Backend (${data.cod}):`, data.message);
        return null;
    }

    const { daily, hourly, city } = data;

    const mapItem = (time: string, i: number, isHourly: boolean) => ({
        dt: Math.floor(new Date(time).getTime() / 1000),
        temp: isHourly ? hourly.temperature_2m[i] : daily.temperature_2m_max[i],
        feels_like: isHourly ? hourly.apparent_temperature[i] : daily.apparent_temperature_max[i],
        humidity: isHourly ? hourly.relative_humidity_2m[i] : 50,
        wind_speed: isHourly ? hourly.wind_speed_10m[i] : 0,
        weather: mapWMOCode(isHourly ? hourly.weather_code[i] : daily.weather_code[i]),
        pop: (isHourly ? hourly.precipitation_probability[i] : daily.precipitation_probability_max[i]) / 100,
    });

    const hourlyList: WeatherForecast[] = hourly.time.map((t: string, i: number) => mapItem(t, i, true));
    const dailyList: WeatherForecast[] = daily.time.map((t: string, i: number) => mapItem(t, i, false));
    const list = dailyList.slice(0, 7);

    return {
        city: city.name,
        country: city.country,
        list,
        hourly: hourlyList,
    };
};

export const getWeatherData = async (cityName: string): Promise<WeatherData | null> => {
    try {
        const res = await fetch(`${BACKEND_URL}?city=${encodeURIComponent(cityName)}`);
        const data = await res.json();
        return processWeatherData(data);
    } catch (error) {
        console.error("Không thể kết nối với Backend:", error);
        return null;
    }
};

export const getWeatherDataByCoords = async (lat: number, lon: number, name?: string, isAuto?: boolean): Promise<WeatherData | null> => {
    try {
        const url = new URL(BACKEND_URL);
        url.searchParams.append('lat', lat.toString());
        url.searchParams.append('lon', lon.toString());
        if (name) url.searchParams.append('name', name);
        if (isAuto) url.searchParams.append('isAuto', 'true');

        const res = await fetch(url.toString());
        const data = await res.json();
        return processWeatherData(data);
    } catch (error) {
        console.error("Không thể kết nối với Backend:", error);
        return null;
    }
};

export const analyzeGoOut = (weather: WeatherForecast, isMandatory: boolean = false): GoOutAnalysis => {
    const essentials: string[] = [];
    let shouldGo: "safe" | "caution" | "avoid" = "safe";
    let reason = "Thời tiết tuyệt vời để ra ngoài!";

    if (weather.weather.main === "Rain" || weather.weather.main === "Thunderstorm") {
        essentials.push("Ô", "Áo mưa");
        shouldGo = isMandatory ? "caution" : "avoid";
        reason = `Có ${weather.weather.description}. ${isMandatory ? "Nền mang ô/áo mưa vì đây là việc bắt buộc." : "Không nên ra ngoài nếu không cần thiết."}`;
    } else if (weather.weather.main === "Drizzle") {
        essentials.push("Ô nhẹ");
        shouldGo = "caution";
        reason = "Có mưa phùn nhẹ.";
    }

    if (weather.temp > 35) {
        essentials.push("Kem chống nắng", "Mũ", "Áo chống nắng");
        shouldGo = "caution";
        reason = `Trời rất nóng (${Math.round(weather.temp)}°C). Cẩn thận sốc nhiệt.`;
    } else if (weather.temp < 15) {
        essentials.push("Áo khoác dày", "Khăn quàng");
        shouldGo = "caution";
        reason = `Trời trở lạnh (${Math.round(weather.temp)}°C).`;
    }

    if (weather.wind_speed > 25) {
        shouldGo = "avoid";
        reason = "Gió rất mạnh, không an toàn.";
    }

    if (weather.uvi && weather.uvi > 8) {
        essentials.push("Kính râm", "Kem chống nắng");
        if (shouldGo === "safe") reason = "Nắng gắt, chỉ số UV cao.";
    }

    // tính comfort score (0-100)
    let comfortScore = 100;

    // trừ điểm temp (lý tưởng 20-26°c)
    if (weather.temp > 26) comfortScore -= (weather.temp - 26) * 4;
    else if (weather.temp < 20) comfortScore -= (20 - weather.temp) * 3;

    // trừ điểm độ ẩm (lý tưởng 40-60%)
    if (weather.humidity > 65) comfortScore -= (weather.humidity - 65) * 0.5;
    else if (weather.humidity < 35) comfortScore -= (35 - weather.humidity) * 0.5;

    // trừ điểm gió (lý tưởng < 15km/h)
    if (weather.wind_speed > 15) comfortScore -= (weather.wind_speed - 15) * 1.5;

    // trừ điểm mưa & thời tiết
    if (weather.weather.main === "Rain") comfortScore -= 40;
    else if (weather.weather.main === "Thunderstorm") comfortScore -= 70;
    else if (weather.weather.main === "Drizzle") comfortScore -= 20;

    // trừ điểm xác suất mưa (%)
    comfortScore -= (weather.pop * 20);

    // giới hạn score 0-100
    comfortScore = Math.max(0, Math.min(100, Math.round(comfortScore)));

    return { shouldGo, reason, essentials: [...new Set(essentials)], comfortScore };
};

export const analyzeGoOutDual = (originWeather: WeatherForecast, destWeather: WeatherForecast, isMandatory: boolean = false): GoOutAnalysis => {
    const originAna = analyzeGoOut(originWeather, isMandatory);
    const destAna = analyzeGoOut(destWeather, isMandatory);

    const essentials = [...new Set([...originAna.essentials, ...destAna.essentials])];
    const comfortScore = Math.round((originAna.comfortScore + destAna.comfortScore) / 2);

    let shouldGo: "safe" | "caution" | "avoid" = "safe";
    let reason = "";

    if (originAna.shouldGo === "avoid" && destAna.shouldGo === "avoid") {
        shouldGo = "avoid";
        reason = "Thời tiết rất xấu ở cả nơi đi và nơi đến. Khuyên bạn nên ở nhà.";
    } else if (originAna.shouldGo === "avoid") {
        shouldGo = isMandatory ? "caution" : "avoid";
        reason = `Nơi đi đang có ${originWeather.weather.description}, rất khó khăn để khởi hành.`;
    } else if (destAna.shouldGo === "avoid") {
        shouldGo = isMandatory ? "caution" : "avoid";
        reason = `Nơi đi thì ổn nhưng nơi đến đang có ${destWeather.weather.description}.`;
    } else if (originAna.shouldGo === "caution" || destAna.shouldGo === "caution") {
        shouldGo = "caution";
        reason = "Thời tiết có chút biến động ở một trong hai nơi. Hãy cân nhắc.";
    } else {
        shouldGo = "safe";
        reason = "Thời tiết đẹp ở cả hai nơi. Chúc bạn một ngày tốt lành!";
    }

    return { shouldGo, reason, essentials, comfortScore };
};

// cache tránh gọi api quá nhiều
const weatherCache: Record<string, { data: WeatherData, ts: number }> = {};

// geocode tên địa điểm -> tọa độ (nominatim)
const geocodeLocation = async (name: string): Promise<{ lat: number, lon: number, displayName: string } | null> => {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=vi`,
            { headers: { 'User-Agent': 'ShouldIGoOut-App' } }
        );
        const data = await res.json();
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lon: parseFloat(data[0].lon),
                displayName: data[0].display_name.split(',')[0]
            };
        }
        return null;
    } catch (error) {
        console.error("Geocode error:", error);
        return null;
    }
};

export const getCachedWeatherData = async (locationName: string, lat?: number, lon?: number): Promise<WeatherData | null> => {
    const now = Date.now();
    if (weatherCache[locationName] && (now - weatherCache[locationName].ts < 10 * 60 * 1000)) { // 10 mins cache
        return weatherCache[locationName].data;
    }

    let targetLat = lat;
    let targetLon = lon;

    // ko có tọa độ mới đi geocode
    if (targetLat === undefined || targetLon === undefined) {
        const geo = await geocodeLocation(locationName);
        if (!geo) {
            console.warn(`Không thể geocode địa điểm: ${locationName}`);
            return null;
        }
        targetLat = geo.lat;
        targetLon = geo.lon;
    }

    // b2: lấy thời tiết bằng tọa độ
    const data = await getWeatherDataByCoords(targetLat, targetLon, locationName);
    if (data) weatherCache[locationName] = { data, ts: now };
    return data;
};
