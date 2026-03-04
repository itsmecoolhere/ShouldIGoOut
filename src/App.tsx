import { useState, useEffect, useRef } from 'react';
import {
  MapPin, Plus, Trash, Loader2, Search, CheckCircle, AlertTriangle, XCircle, Info,
  Calendar, ChevronLeft, ChevronRight, FileUp, Wind, Droplets, Sparkles
} from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, isToday
} from 'date-fns';
import { vi } from 'date-fns/locale';
import { analyzeGoOut, analyzeGoOutDual, getWeatherData, getWeatherDataByCoords, getCachedWeatherData, getAirQuality, getAqiInfo } from './services/WeatherService';
import type { WeatherData, WeatherForecast, AirQualityData } from './services/WeatherService';
import { getStoredSchedule, addEvent, removeEvent, addEventsBulk, clearSchedule, clearEventsForDay } from './services/ScheduleService';
import type { Event } from './services/ScheduleService';
import ICAL from 'ical.js';
import './App.css';

const getWeatherEmoji = (main: string) => {
  switch (main) {
    case 'Clear': return '☀️';
    case 'Clouds': return '☁️';
    case 'Rain': return '🌧️';
    case 'Drizzle': return '🌦️';
    case 'Thunderstorm': return '⛈️';
    case 'Snow': return '❄️';
    case 'Fog': return '🌫️';
    default: return '🌤️';
  }
};

export default function App() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [schedule, setSchedule] = useState<Event[]>([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const [city, setCity] = useState('Thành phố Hồ Chí Minh');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const [calendarModal, setCalendarModal] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [form, setForm] = useState({ title: '', location: '', lat: undefined as number | undefined, lon: undefined as number | undefined, time: format(new Date(), "yyyy-MM-dd'T'HH:mm"), mandatory: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeHour, setActiveHour] = useState<WeatherForecast | null>(null);
  const [now, setNow] = useState(new Date());
  const [dualView, setDualView] = useState<{ origin: WeatherForecast; dest: WeatherForecast; originCity: string; destCity: string; isMandatory?: boolean } | null>(null);
  const [icsLoading, setIcsLoading] = useState(false);
  const [icsProgress, setIcsProgress] = useState({ current: 0, total: 0, locName: '' });
  const [aiAnalysis, setAiAnalysis] = useState<{ loading: boolean; cache: Record<string, any>; activeDate: string | null }>({
    loading: false,
    cache: JSON.parse(localStorage.getItem('weather_ai_cache') || '{}'),
    activeDate: null
  });
  const [airQuality, setAirQuality] = useState<AirQualityData | null>(null);


  const activeHourlyRef = useRef<HTMLDivElement>(null);
  const userCoordsRef = useRef<{ lat: number; lon: number } | null>(null);

  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [formSuggestions, setFormSuggestions] = useState<any[]>([]);
  const [showFormSuggestions, setShowFormSuggestions] = useState(false);

  useEffect(() => {
    initApp();
    setSchedule(getStoredSchedule());

    // timer upd đồng hồ mỗi phút
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // thời tiết điểm đến - auto lấy cho event < 2 ngày
  const [destWeatherMap, setDestWeatherMap] = useState<Record<string, WeatherData>>({});
  const [destLoadingMap, setDestLoadingMap] = useState<Record<string, boolean>>({});
  const [manualCalcSet, setManualCalcSet] = useState<Set<string>>(new Set());

  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;



  const handleManualCalc = async (ev: Event) => {
    // nếu có điểm đến khác, fetch thời tiết trước
    if (ev.location && ev.location !== city && !destWeatherMap[ev.location]) {
      await fetchDestWeatherWithCoords(ev.location, ev.lat, ev.lon);
    }
    setManualCalcSet(prev => new Set(prev).add(ev.id));
  };
  const fetchDestWeatherWithCoords = async (loc: string, lat?: number, lon?: number) => {
    if (destWeatherMap[loc] || destLoadingMap[loc]) return;
    setDestLoadingMap(prev => ({ ...prev, [loc]: true }));
    const data = await getCachedWeatherData(loc, lat, lon);
    if (data) {
      setDestWeatherMap(prev => ({ ...prev, [loc]: data }));
    }
    setDestLoadingMap(prev => ({ ...prev, [loc]: false }));
  };

  useEffect(() => {
    // auto fetch cho event < 2 ngày
    const nearEvents = schedule.filter(e => {
      const diff = e.time.getTime() - now.getTime();
      return diff > 0 && diff < TWO_DAYS_MS && e.location && e.location !== city;
    });

    // gom event theo vị trí để lấy tọa độ
    const uniqueLocs = new Map<string, { lat?: number, lon?: number }>();
    nearEvents.forEach(e => {
      if (e.location && !uniqueLocs.has(e.location)) {
        uniqueLocs.set(e.location, { lat: e.lat, lon: e.lon });
      }
    });

    for (const [loc, coords] of uniqueLocs.entries()) {
      if (!destWeatherMap[loc]) {
        fetchDestWeatherWithCoords(loc, coords.lat, coords.lon);
      }
    }
  }, [schedule, city]);

  // logic gợi ý tìm kiếm (autocomplete)
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const biasParams = userCoordsRef.current ? `&lat=${userCoordsRef.current.lat}&lon=${userCoordsRef.current.lon}` : '';
        const res = await fetch(`http://localhost:5000/api/autocomplete?text=${encodeURIComponent(query)}${biasParams}`);
        const data = await res.json();
        const formatted = (data.features || []).map((item: any) => {
          const props = item.properties || {};
          const mainName = props.name || '';

          const ward = props.locality || '';
          const district = props.county || '';
          const cityName = props.region || '';
          const subParts = [ward, district, cityName].filter(Boolean);

          return {
            id: props.id,
            name: mainName,
            fullName: props.label || mainName,
            sub: subParts.join(', ')
          };
        });
        setSuggestions(formatted);
      } catch (err) {
        setSuggestions([]);
      }
    };

    const timer = setTimeout(fetchSuggestions, 500);
    return () => clearTimeout(timer);
  }, [query]);

  // logic gợi ý cho modal thêm lịch
  useEffect(() => {
    const fetchFormSuggestions = async () => {
      if (!form.location || form.location.trim().length < 2) {
        setFormSuggestions([]);
        return;
      }
      try {
        const biasParams = userCoordsRef.current ? `&lat=${userCoordsRef.current.lat}&lon=${userCoordsRef.current.lon}` : '';
        const res = await fetch(`http://localhost:5000/api/autocomplete?text=${encodeURIComponent(form.location)}${biasParams}`);
        const data = await res.json();
        const formatted = (data.features || []).map((item: any) => {
          const props = item.properties || {};
          const mainName = props.name || '';

          const ward = props.locality || '';
          const district = props.county || '';
          const cityName = props.region || '';
          const subParts = [ward, district, cityName].filter(Boolean);

          return {
            id: props.id,
            name: mainName,
            fullName: props.label || mainName,
            sub: subParts.join(', ')
          };
        });
        setFormSuggestions(formatted);
      } catch (err) {
        setFormSuggestions([]);
      }
    };

    const timer = setTimeout(fetchFormSuggestions, 500);
    return () => clearTimeout(timer);
  }, [form.location]);

  // cuộn tới mốc giờ đc chọn
  useEffect(() => {
    if (activeHourlyRef.current) {
      activeHourlyRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [activeHour]);

  // đổi ngày hoặc có data mới, mặc định lấy giờ khớp nhất
  useEffect(() => {
    if (weather) {
      if (isToday(new Date(weather.list[selectedDay].dt * 1000))) {
        // tìm giờ gần nhất cho hôm nay
        const currentHour = now.getHours();
        const currentMins = now.getMinutes();
        const targetHour = currentHour + (currentMins >= 30 ? 1 : 0);

        const targetDate = new Date(now);
        targetDate.setHours(targetHour, 0, 0, 0);
        const targetTs = Math.floor(targetDate.getTime() / 1000);

        // tìm mốc khớp nhất trg hourly
        const found = weather.hourly.find(h => h.dt === targetTs);
        setActiveHour(found || weather.list[selectedDay]);
      } else {
        // ngày khác mặc định lấy 00:00
        const dayDate = new Date(weather.list[selectedDay].dt * 1000);
        const firstHour = weather.hourly.find(h => {
          const hDate = new Date(h.dt * 1000);
          return hDate.getDate() === dayDate.getDate() && hDate.getHours() === 0;
        });
        setActiveHour(firstHour || weather.list[selectedDay]);
      }
    }
  }, [weather, selectedDay]);

  const initApp = () => {
    setLoading(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          userCoordsRef.current = { lat: latitude, lon: longitude };
          const data = await getWeatherDataByCoords(latitude, longitude, undefined, true);
          if (data) {
            setWeather(data);
            setCity(data.city);
            setLoading(false);
            // fetch aqi theo tọa độ
            getAirQuality(latitude, longitude).then(aq => setAirQuality(aq));
          } else {
            fallbackToDefault("Không thể lấy dữ liệu thời tiết cho vị trí của bạn.");
          }
        },
        (err) => {
          console.error("Geolocation error:", err);
          fallbackToDefault("Vui lòng cho phép truy cập vị trí hoặc tìm kiếm thủ công.");
        }
      );
    } else {
      fallbackToDefault();
    }
  };

  const fallbackToDefault = async (msg?: string) => {
    if (msg) console.warn(msg);
    const data = await getWeatherData('Thành phố Hồ Chí Minh');
    if (data) {
      setWeather(data);
      setCity(data.city);
      if (msg) setError(msg);
    } else {
      setError("Không thể kết nối với dịch vụ thời tiết.");
    }
    setLoading(false);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportICS = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      setIcsLoading(true);
      try {
        const text = event.target?.result as string;
        const jcalData = ICAL.parse(text);
        const comp = new ICAL.Component(jcalData);
        const vevents = comp.getAllSubcomponents('vevent');

        const newEventsList: Omit<Event, "id">[] = vevents.map(v => {
          const event = new ICAL.Event(v);
          return {
            title: event.summary,
            time: event.startDate.toJSDate(),
            location: event.location || '',
            isMandatory: false
          };
        });

        if (newEventsList.length > 0) {
          // geocode vị trí qua backend proxy
          const uniqueLocs = [...new Set(newEventsList.map(e => e.location).filter(Boolean))];
          let geoCache: Record<string, { lat: number; lon: number }> = {};

          try {
            setIcsProgress({ current: 0, total: uniqueLocs.length, locName: '' });
            for (let i = 0; i < uniqueLocs.length; i++) {
              const loc = uniqueLocs[i];
              setIcsProgress({ current: i + 1, total: uniqueLocs.length, locName: loc.length > 40 ? loc.slice(0, 40) + '...' : loc });
              try {
                // gợi ý tìm kiếm
                const biasParams = userCoordsRef.current ? `&lat=${userCoordsRef.current.lat}&lon=${userCoordsRef.current.lon}` : '';
                const autoRes = await fetch(`http://localhost:5000/api/autocomplete?text=${encodeURIComponent(loc)}${biasParams}`);
                const autoData = await autoRes.json();
                const feature = autoData.features?.[0];
                if (feature?.properties?.id) {
                  // chi tiết địa điểm
                  const placeRes = await fetch(`http://localhost:5000/api/place?id=${feature.properties.id}`);
                  const placeData = await placeRes.json();
                  const placeFeature = placeData.features?.[0];
                  if (placeFeature?.geometry?.coordinates) {
                    const [lon, lat] = placeFeature.geometry.coordinates;
                    geoCache[loc] = { lat, lon };
                  }
                }
              } catch (err) {
                console.warn(`Geocode failed for: ${loc}`, err);
              }
            }
          } catch (err) {
            console.warn('Geocode progress failed:', err);
          }

          // gán tọa độ cho từng event
          const eventsWithCoords = newEventsList.map(e => {
            const geo = e.location ? geoCache[e.location] : undefined;
            return {
              ...e,
              lat: geo?.lat,
              lon: geo?.lon
            };
          });

          const updated = addEventsBulk(schedule, eventsWithCoords);
          setSchedule(updated);
          alert(`Đã nhập thành công ${newEventsList.length} lịch trình từ file ICS!`);
        }
      } catch (err) {
        console.error("ICS Parse Error:", err);
        alert("Không thể đọc file ICS. Vui lòng kiểm tra lại định dạng file.");
      } finally {
        setIcsLoading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset để upload lại đc
  };

  const handleClearAll = () => {
    if (schedule.length === 0) return;
    if (confirm('Bạn có chắc chắn muốn xóa TẤT CẢ lịch trình trong toàn bộ các ngày không?')) {
      setSchedule(clearSchedule());
    }
  };

  const handleClearDay = (date: Date) => {
    const dayEvents = schedule.filter(e => isSameDay(e.time, date));
    if (dayEvents.length === 0) return;
    if (confirm(`Bạn muốn xóa tất cả lịch trình của ngày ${format(date, 'd/M')}?`)) {
      setSchedule(clearEventsForDay(schedule, date));
    }
  };

  const fetchWeather = async (name: string, lat?: number, lon?: number, isAuto = false) => {
    setLoading(true);
    setError('');
    const data = (lat !== undefined && lon !== undefined)
      ? await getWeatherDataByCoords(lat, lon, name, isAuto)
      : await getWeatherData(name);

    if (!data) setError(`Không thể lấy dữ liệu cho "${name || 'vị trí này'}".`);
    else {
      setWeather(data);
      setCity(data.city);
      // fetch aqi nếu có tọa độ
      if (lat !== undefined && lon !== undefined) {
        getAirQuality(lat, lon).then(aq => setAirQuality(aq));
      }
    }
    setLoading(false);
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) { fetchWeather(query.trim()); setQuery(''); }
  };



  const handleAskAI = async () => {

    if (!weather || !activeHour) return;
    const currentDay = weather.list[selectedDay];
    const dateStr = format(new Date(currentDay.dt * 1000), 'yyyy-MM-dd');

    // nếu ai đã phân tích rồi thì hiện luôn
    if (aiAnalysis.cache[dateStr]) {
      setAiAnalysis(prev => ({ ...prev, activeDate: dateStr }));
      return;
    }

    setAiAnalysis(prev => ({ ...prev, loading: true }));

    try {
      // lấy event của ngày đc chọn
      const dayEvents = schedule.filter(e => {
        const d = new Date(currentDay.dt * 1000);
        return e.time.getDate() === d.getDate() && e.time.getMonth() === d.getMonth() && e.time.getFullYear() === d.getFullYear();
      });

      const res = await fetch('http://localhost:5000/api/analyze-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: format(new Date(currentDay.dt * 1000), 'dd/MM/yyyy'),
          weatherData: {
            city: weather.city,
            temp: activeHour.temp,
            feels_like: activeHour.feels_like,
            weather: activeHour.weather,
            pop: activeHour.pop,
            wind_speed: activeHour.wind_speed,
          },
          eventsList: dayEvents.map(e => ({
            title: e.title,
            time: e.time,
            location: e.location || weather.city
          }))
        })
      });

      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      const newCache = { ...aiAnalysis.cache, [dateStr]: data };
      setAiAnalysis({ loading: false, cache: newCache, activeDate: dateStr });
      localStorage.setItem('weather_ai_cache', JSON.stringify(newCache));
    } catch (err) {
      console.error(err);
      setAiAnalysis(prev => ({ ...prev, loading: false }));
      alert('Có lỗi khi gọi AI. Vui lòng kiểm tra lại backend hoặc API Key.');
    }
  };

  const onAddEvent = () => {
    if (!form.title) return;
    const eventTime = new Date(form.time);
    if (eventTime < now) {
      alert("Không thể thêm sự kiện trong quá khứ!");
      return;
    }
    setSchedule(addEvent(schedule, {
      title: form.title,
      time: eventTime,
      location: form.location || city,
      lat: form.lat,
      lon: form.lon,
      isMandatory: form.mandatory
    }));
    setModal(false);
    setForm({ title: '', location: '', lat: undefined, lon: undefined, time: format(new Date(), "yyyy-MM-dd'T'HH:mm"), mandatory: false });
  };

  // đang tải
  if (loading) return (
    <div className="loading-full">
      <div className="error-box" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Đang lấy dữ liệu thời tiết</h2>
        <div className="spinner"></div>
      </div>
    </div>
  );

  // lỗi (ko lấy đc thời tiết)
  if (!weather || !activeHour) return (
    <div className="loading-full">
      <div className="error-box">
        <AlertTriangle size={32} color="#737373" />
        <h3>{error || 'Không thể kết nối với dịch vụ thời tiết.'}</h3>
        <button onClick={initApp}>Thử lại</button>
      </div>
    </div>
  );

  const day = weather.list[selectedDay];
  const todayEvents = schedule.filter(ev => {
    const d = new Date(day.dt * 1000);
    return ev.time.getDate() === d.getDate() &&
      ev.time.getMonth() === d.getMonth() &&
      ev.time.getFullYear() === d.getFullYear();
  }).sort((a, b) => {
    const isAPast = a.time < now;
    const isBPast = b.time < now;
    if (isAPast && !isBPast) return 1;
    if (!isAPast && isBPast) return -1;
    return a.time.getTime() - b.time.getTime();
  });

  // dùng activeHour để phân tích
  const currentAnalysis = analyzeGoOut(activeHour, todayEvents.some(e => e.isMandatory));

  return (
    <div className="app-shell">
      {/* sidebar */}
      <aside className="sidebar">
        <div>
          <div className="sidebar-title">Should I Go Out?</div>
          <div className="sidebar-loc"><MapPin size={12} /> {weather.city}, {weather.country}</div>
        </div>

        <div className="search-container">
          <form className="search-form" onSubmit={onSearch}>
            <Search size={14} className="search-icon" />
            <input
              placeholder="Tìm kiếm thành phố..."
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            />
          </form>

          {showSuggestions && suggestions.length > 0 && (
            <div className="suggestions-list">
              {suggestions.map((s, idx) => (
                <div
                  key={`${s.id}-${idx}`}
                  className="suggestion-item"
                  onMouseDown={async (e) => {
                    e.preventDefault();
                    try {
                      const res = await fetch(`http://localhost:5000/api/place?id=${s.id}`);
                      const data = await res.json();
                      const feature = data.features?.[0];
                      if (feature?.geometry?.coordinates) {
                        const [lon, lat] = feature.geometry.coordinates;
                        fetchWeather(s.fullName || s.name, lat, lon);
                      } else {
                        fetchWeather(s.fullName || s.name);
                      }
                    } catch (err) {
                      fetchWeather(s.name);
                    }
                    setQuery('');
                    setSuggestions([]);
                    setShowSuggestions(false);
                  }}
                >
                  <span className="s-name">{s.name}</span>
                  <span className="s-admin">{s.sub}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="day-list">
          {weather.list.map((d, i) => {
            const today = isToday(new Date(d.dt * 1000));
            return (
              <button
                key={d.dt}
                className={`day-btn ${selectedDay === i ? 'active' : ''} ${today ? 'is-today' : ''}`}
                onClick={() => { setSelectedDay(i); setDualView(null); }}
              >
                <span>{today ? 'Hôm nay' : format(new Date(d.dt * 1000), 'EEEE', { locale: vi })}</span>
                <span className="temp">{Math.round(d.temp)}°</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* main */}
      <main className="main">
        {error && (
          <div className="alert-bar">
            <Info size={16} />
            <span>{error}</span>
            <button className="close-alert" onClick={() => setError('')}>&times;</button>
          </div>
        )}
        <div className="top-bar">
          <div className="header-main">
            <h1>{format(new Date(day.dt * 1000), 'EEEE, d MMMM yyyy', { locale: vi })}</h1>
            <div className="current-clock">{format(now, 'HH:mm')}</div>
            <div className="header-city">{weather.city}</div>
          </div>
          {!dualView && (
            <button
              className="ai-float-btn"
              onClick={handleAskAI}
              disabled={aiAnalysis.loading}
              title={aiAnalysis.cache[format(new Date(day.dt * 1000), 'yyyy-MM-dd')] ? "Xem AI tư vấn lưu sẵn" : "Hỏi AI tư vấn thời tiết"}
            >
              {aiAnalysis.loading ? <Loader2 className="spinning" size={14} /> : <Sparkles size={14} />}
              <span>
                {aiAnalysis.loading
                  ? 'Đang hỏi AI...'
                  : aiAnalysis.cache[format(new Date(day.dt * 1000), 'yyyy-MM-dd')]
                    ? 'Xem AI'
                    : 'Hỏi AI'}
              </span>
            </button>
          )}
        </div>

        {/* modal kết quả ai */}
        {(activeHour && aiAnalysis.activeDate === format(new Date(activeHour.dt * 1000), 'yyyy-MM-dd') && aiAnalysis.cache[aiAnalysis.activeDate]) && (
          <div className="ai-modal-overlay" onClick={() => setAiAnalysis(prev => ({ ...prev, activeDate: null }))}>
            <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ai-modal-header">
                <div className="ai-modal-title"><Sparkles size={16} color="#a855f7" /> AI Tư vấn</div>
                <button className="ai-modal-close" onClick={() => setAiAnalysis(prev => ({ ...prev, activeDate: null }))}>&times;</button>
              </div>
              <div className="ai-modal-body">
                {(() => {
                  const data = aiAnalysis.cache[aiAnalysis.activeDate!];
                  return (
                    <>
                      <div className="ai-card">
                        <div className="ai-card-title">Tổng quan</div>
                        <p>{data.summary}</p>
                      </div>
                      <div className="ai-card">
                        <div className="ai-card-title">Chuẩn bị</div>
                        <div className="ai-prep-pills">
                          {(Array.isArray(data.preparations) ? data.preparations : [data.preparations]).map((p: string, i: number) => (
                            <span key={i} className="ai-prep-pill">{p}</span>
                          ))}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* lưới nội dung: stats | trực quan | dự báo giờ */}
        <div className="content-grid">
          {/* Center: Decision + Visual */}
          {dualView ? (
            /* so sánh thời tiết nơi đi vs nơi đến */
            <div className="weather-hero dual-hero">
              <button className="dual-close-btn" onClick={() => setDualView(null)} title="Đóng so sánh">
                <Plus size={18} style={{ transform: 'rotate(45deg)' }} />
              </button>
              <div className="dual-hero-grid">
                {/* bên trái: nơi hiện tại */}
                {(() => {
                  const ana = analyzeGoOut(dualView.origin, dualView.isMandatory);
                  return (
                    <div className={`dual-panel ${ana.shouldGo}`}>
                      <div className="dual-panel-label">📍 Nơi hiện tại</div>
                      <div className="dual-panel-city">{dualView.originCity}</div>
                      <div className="hero-visual"><span className="big-weather-emoji">{getWeatherEmoji(dualView.origin.weather.main)}</span></div>
                      <div className="hero-weather-meta">
                        <span className="weather-description">{dualView.origin.weather.description}</span>
                        <span className="visual-time">{format(new Date(dualView.origin.dt * 1000), 'HH:00')}</span>
                      </div>
                      <div className="hero-temp-display">
                        <span className="hero-temp-value">{Math.round(dualView.origin.temp)}°</span>
                        <span className="hero-temp-feels">Cảm giác {Math.round(dualView.origin.feels_like)}°</span>
                      </div>
                      <div className="hero-stats-row">
                        <div className="hero-stat-chip"><Wind size={13} /><span>{Math.round(dualView.origin.wind_speed)} km/h</span></div>
                        <div className="hero-stat-chip"><Droplets size={13} /><span>{dualView.origin.humidity}%</span></div>
                        <div className="hero-stat-chip"><span>🌧️ {Math.round(dualView.origin.pop * 100)}%</span></div>
                      </div>
                      <div className="hero-decision">
                        <div className="decision-icon">
                          {ana.shouldGo === 'safe' && <CheckCircle size={16} color="#22c55e" />}
                          {ana.shouldGo === 'caution' && <AlertTriangle size={16} color="#eab308" />}
                          {ana.shouldGo === 'avoid' && <XCircle size={16} color="#ef4444" />}
                        </div>
                        <div className="decision-text">
                          <h3>{ana.shouldGo === 'safe' ? 'An toàn' : ana.shouldGo === 'caution' ? 'Cẩn thận' : 'Nguy hiểm'}</h3>
                          <p>{ana.reason}</p>
                        </div>
                      </div>
                      <div className="comfort-section">
                        <div className="comfort-label">Thoải mái: {ana.comfortScore}%</div>
                        <div className="comfort-bar"><div className={`comfort-fill ${ana.shouldGo}`} style={{ width: `${ana.comfortScore}%` }} /></div>
                      </div>
                    </div>
                  );
                })()}
                {/* bên phải: nơi đến */}
                {(() => {
                  const ana = analyzeGoOut(dualView.dest, dualView.isMandatory);
                  return (
                    <div className={`dual-panel ${ana.shouldGo}`}>
                      <div className="dual-panel-label">🎯 Điểm đến</div>
                      <div className="dual-panel-city">{dualView.destCity}</div>
                      <div className="hero-visual"><span className="big-weather-emoji">{getWeatherEmoji(dualView.dest.weather.main)}</span></div>
                      <div className="hero-weather-meta">
                        <span className="weather-description">{dualView.dest.weather.description}</span>
                        <span className="visual-time">{format(new Date(dualView.dest.dt * 1000), 'HH:00')}</span>
                      </div>
                      <div className="hero-temp-display">
                        <span className="hero-temp-value">{Math.round(dualView.dest.temp)}°</span>
                        <span className="hero-temp-feels">Cảm giác {Math.round(dualView.dest.feels_like)}°</span>
                      </div>
                      <div className="hero-stats-row">
                        <div className="hero-stat-chip"><Wind size={13} /><span>{Math.round(dualView.dest.wind_speed)} km/h</span></div>
                        <div className="hero-stat-chip"><Droplets size={13} /><span>{dualView.dest.humidity}%</span></div>
                        <div className="hero-stat-chip"><span>🌧️ {Math.round(dualView.dest.pop * 100)}%</span></div>
                      </div>
                      <div className="hero-decision">
                        <div className="decision-icon">
                          {ana.shouldGo === 'safe' && <CheckCircle size={16} color="#22c55e" />}
                          {ana.shouldGo === 'caution' && <AlertTriangle size={16} color="#eab308" />}
                          {ana.shouldGo === 'avoid' && <XCircle size={16} color="#ef4444" />}
                        </div>
                        <div className="decision-text">
                          <h3>{ana.shouldGo === 'safe' ? 'An toàn' : ana.shouldGo === 'caution' ? 'Cẩn thận' : 'Nguy hiểm'}</h3>
                          <p>{ana.reason}</p>
                        </div>
                      </div>
                      <div className="comfort-section">
                        <div className="comfort-label">Thoải mái: {ana.comfortScore}%</div>
                        <div className="comfort-bar"><div className={`comfort-fill ${ana.shouldGo}`} style={{ width: `${ana.comfortScore}%` }} /></div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            /* view bình thường */
            <div className={`weather-hero ${currentAnalysis.shouldGo}`}>
              <div className={`hero-glow ${currentAnalysis.shouldGo}`} />

              {/* hiệu ứng thời tiết động */}
              <div className={`weather-fx weather-${activeHour.weather.main.toLowerCase()}`}>
                {(activeHour.weather.main === 'Rain' || activeHour.weather.main === 'Drizzle') && (
                  <div className="rain-container">
                    {Array.from({ length: activeHour.weather.main === 'Rain' ? 40 : 15 }).map((_, i) => (
                      <div key={i} className="raindrop" style={{
                        left: `${Math.random() * 100}%`,
                        animationDuration: `${0.5 + Math.random() * 0.5}s`,
                        animationDelay: `${Math.random() * 2}s`,
                        opacity: 0.3 + Math.random() * 0.5,
                      }} />
                    ))}
                  </div>
                )}
                {activeHour.weather.main === 'Thunderstorm' && (
                  <>
                    <div className="rain-container">
                      {Array.from({ length: 50 }).map((_, i) => (
                        <div key={i} className="raindrop heavy" style={{
                          left: `${Math.random() * 100}%`,
                          animationDuration: `${0.3 + Math.random() * 0.3}s`,
                          animationDelay: `${Math.random() * 1.5}s`,
                          opacity: 0.4 + Math.random() * 0.5,
                        }} />
                      ))}
                    </div>
                    <div className="lightning-layer" />
                  </>
                )}
                {activeHour.weather.main === 'Clouds' && (
                  <div className="clouds-container">
                    <div className="cloud cloud-1" />
                    <div className="cloud cloud-2" />
                    <div className="cloud cloud-3" />
                  </div>
                )}
                {activeHour.weather.main === 'Clear' && (
                  <div className="sun-container">
                    <div className="sun-glow" />
                    <div className="sun-rays" />
                  </div>
                )}
                {activeHour.weather.main === 'Fog' && (
                  <div className="fog-container">
                    <div className="fog-layer fog-1" />
                    <div className="fog-layer fog-2" />
                    <div className="fog-layer fog-3" />
                  </div>
                )}
              </div>

              <div className="hero-animated-content" key={activeHour.dt}>
                <div className="hero-visual">
                  <span className="big-weather-emoji">{getWeatherEmoji(activeHour.weather.main)}</span>
                </div>
                <div className="hero-weather-meta">
                  <span className="weather-description">{activeHour.weather.description}</span>
                  <span className="visual-time">{format(new Date(activeHour.dt * 1000), 'HH:00')}</span>
                </div>
                <div className="hero-temp-display">
                  <span className="hero-temp-value">{Math.round(activeHour.temp)}°</span>
                  <span className="hero-temp-feels">Cảm giác {Math.round(activeHour.feels_like)}°</span>
                </div>
                <div className="hero-stats-row">
                  <div className="hero-stat-chip"><Wind size={13} /><span>{Math.round(activeHour.wind_speed)} km/h</span></div>
                  <div className="hero-stat-chip"><Droplets size={13} /><span>{activeHour.humidity}%</span></div>
                  <div className="hero-stat-chip"><span>🌧️ {Math.round(activeHour.pop * 100)}%</span></div>
                  {airQuality && (() => {
                    const info = getAqiInfo(airQuality.aqi);
                    return (
                      <div className={`hero-stat-chip aqi-chip ${info.className}`} title={`AQI ${airQuality.aqi} - ${info.advice} | PM2.5: ${airQuality.pm25}μg/m³ | PM10: ${airQuality.pm10}μg/m³`}>
                        <span className="aqi-dot" style={{ background: info.color }} />
                        <span>AQI {airQuality.aqi}</span>
                      </div>
                    );
                  })()}
                </div>
                <div className="hero-decision">
                  <div className="decision-icon">
                    {currentAnalysis.shouldGo === 'safe' && <CheckCircle size={18} color="#22c55e" />}
                    {currentAnalysis.shouldGo === 'caution' && <AlertTriangle size={18} color="#eab308" />}
                    {currentAnalysis.shouldGo === 'avoid' && <XCircle size={18} color="#ef4444" />}
                  </div>
                  <div className="decision-text">
                    <h3>
                      {currentAnalysis.shouldGo === 'safe' && 'Có thể ra ngoài'}
                      {currentAnalysis.shouldGo === 'caution' && 'Nên cẩn thận'}
                      {currentAnalysis.shouldGo === 'avoid' && 'Hạn chế ra ngoài'}
                    </h3>
                    <p>{currentAnalysis.reason}</p>
                  </div>
                </div>
                <div className="comfort-section">
                  <div className="comfort-label">Mức thoải mái: {currentAnalysis.comfortScore}%</div>
                  <div className="comfort-bar">
                    <div className={`comfort-fill ${currentAnalysis.shouldGo}`} style={{ width: `${currentAnalysis.comfortScore}%` }} />
                  </div>
                </div>
                {currentAnalysis.essentials.length > 0 && (
                  <div className="essentials-row">
                    <span className="essentials-label">Vật dụng:</span>
                    {currentAnalysis.essentials.map(e => <span key={e} className="pill">{e}</span>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hourly Right */}
          <div className="section-hourly">
            <div className="section-bar">
              <h2>Dự báo chi tiết</h2>
              <span className="hint-text">(Nhấn vào từng giờ để xem chi tiết)</span>
            </div>
            <div className="hourly-list">
              {weather.hourly.filter(h => {
                const d = new Date(day.dt * 1000);
                const hDate = new Date(h.dt * 1000);
                return hDate.getDate() === d.getDate();
              }).map((h) => (
                <div
                  key={h.dt}
                  ref={activeHour.dt === h.dt ? activeHourlyRef : null}
                  className={`hourly-item ${activeHour.dt === h.dt ? 'active' : ''}`}
                  onClick={() => { setActiveHour(h); setDualView(null); }}
                >
                  <span className="time">{format(new Date(h.dt * 1000), 'HH:00')}</span>
                  <span className="hourly-emoji">{getWeatherEmoji(h.weather.main)}</span>
                  <span className="temp">{Math.round(h.temp)}°</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* lịch trình */}
        <div className="schedule-section">
          <div className="section-bar">
            <h2>Lịch trình</h2>
            <div className="bar-actions">
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".ics"
                onChange={handleImportICS}
              />
              <button className="imp-btn" title="Nhập file ICS" onClick={() => fileInputRef.current?.click()}>
                <FileUp size={14} />
              </button>
              <button className="cal-btn" onClick={() => {
                setViewDate(new Date());
                setSelectedDate(new Date());
                setCalendarModal(true);
              }}>
                <Calendar size={14} />
              </button>
              {schedule.length > 0 && (
                <button className="clear-btn" title="Xóa tất cả lịch trình" onClick={handleClearAll}>
                  <Trash size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="event-list">
            {todayEvents.length > 0 ? todayEvents.map(ev => {
              const evHour = ev.time.getHours();
              const evDay = ev.time.getDate();
              const hourForecast = weather.hourly.find(h => {
                const d = new Date(h.dt * 1000);
                return d.getDate() === evDay && d.getHours() === evHour;
              });

              const isPast = ev.time < now;
              const isUpcoming = !isPast && (ev.time.getTime() - now.getTime()) < 2 * 60 * 60 * 1000;

              const isWithin2Days = (ev.time.getTime() - now.getTime()) < TWO_DAYS_MS;
              const hasDestLocation = !!(ev.location && ev.location !== city);
              const destWeather = hasDestLocation ? destWeatherMap[ev.location] : null;
              const destHourForecast = destWeather?.hourly.find(h => {
                const d = new Date(h.dt * 1000);
                return d.getDate() === evDay && d.getHours() === evHour;
              });
              const isDestLoading = hasDestLocation ? destLoadingMap[ev.location] : false;

              // chỉ phân tích nếu < 2 ngày hoặc bấm thủ công
              const shouldShowAnalysis = isPast || isWithin2Days || manualCalcSet.has(ev.id);

              const analysis = shouldShowAnalysis
                ? (hourForecast && destHourForecast && hasDestLocation)
                  ? analyzeGoOutDual(hourForecast, destHourForecast, ev.isMandatory)
                  : (hourForecast ? analyzeGoOut(hourForecast, ev.isMandatory) : null)
                : null;

              // hiện nút tính nếu > 2 ngày & chưa bấm & chưa qua
              const showCalcButton = !isPast && !isWithin2Days && !manualCalcSet.has(ev.id);

              const statusClass = analysis ? (analysis.shouldGo === 'avoid' && ev.isMandatory ? 'mandatory-warn' : analysis.shouldGo) : '';

              return (
                <div key={ev.id} className={`event-row ${statusClass} ${isPast ? 'is-past' : ''} ${isUpcoming ? 'is-upcoming' : ''}`}>
                  {(isPast) && <div className="event-past-label">Đã qua</div>}
                  {isUpcoming && <div className="event-upcoming-tag">Sắp diễn ra</div>}
                  <div className="event-time-block">
                    <span className="time-main">{format(ev.time, 'HH:mm')}</span>
                    <span className="time-label">Bắt đầu</span>
                  </div>

                  <div className="event-content">
                    <div className="title-row">
                      <span className="title">{ev.title}</span>
                      {ev.isMandatory
                        ? <span className="mandatory-badge">Bắt buộc</span>
                        : <span className="optional-badge">Tự do</span>
                      }
                      {hasDestLocation && (
                        <span className="dest-indicator" title={`Điểm đến: ${ev.location}`}>
                          <ChevronRight size={12} /> {ev.location}
                        </span>
                      )}
                    </div>
                    <div className="event-meta">
                      {ev.location && (
                        <span className="location-tag">
                          <MapPin size={12} /> {ev.location}
                        </span>
                      )}
                    </div>
                  </div>

                  {showCalcButton ? (
                    <button
                      className={`calc-weather-btn ${isDestLoading ? 'loading' : ''}`}
                      onClick={() => handleManualCalc(ev)}
                      disabled={isDestLoading}
                      title="Tính toán thời tiết"
                    >
                      {isDestLoading ? (
                        <><Loader2 size={14} className="spin" /> <span>Đang tải...</span></>
                      ) : (
                        <><Search size={14} /> <span>Tính thời tiết</span></>
                      )}
                    </button>
                  ) : analysis && (
                    <div
                      className={`rec-badge ${statusClass}`}
                      title={analysis.reason}
                      style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        if (hourForecast) {
                          setActiveHour(hourForecast);
                          if (hasDestLocation) {
                            // lấy thời tiết điểm đến nếu chưa có
                            if (!destHourForecast && !destWeatherMap[ev.location]) {
                              await fetchDestWeatherWithCoords(ev.location, ev.lat, ev.lon);
                              // lấy lại data sau khi fetch
                              // dùng cache vì state chưa upd ngay
                              const freshDestWeather = await getCachedWeatherData(ev.location, ev.lat, ev.lon);
                              if (freshDestWeather) {
                                const freshDestHour = freshDestWeather.hourly.find(h => {
                                  const d = new Date(h.dt * 1000);
                                  return d.getDate() === evDay && d.getHours() === evHour;
                                });
                                if (freshDestHour) {
                                  setDualView({ origin: hourForecast, dest: freshDestHour, originCity: city, destCity: ev.location, isMandatory: ev.isMandatory });
                                  return;
                                }
                              }
                            }
                            if (destHourForecast) {
                              setDualView({ origin: hourForecast, dest: destHourForecast, originCity: city, destCity: ev.location, isMandatory: ev.isMandatory });
                            } else {
                              setDualView(null);
                            }
                          } else {
                            setDualView(null);
                          }
                        }
                      }}
                    >
                      {analysis.shouldGo === 'safe' && (
                        <>✅ <span>Nên đi</span></>
                      )}
                      {analysis.shouldGo === 'caution' && (
                        <>⚠️ <span>Cẩn thận</span></>
                      )}
                      {analysis.shouldGo === 'avoid' && (
                        ev.isMandatory ? (
                          <>⚠️ <span>Bắt buộc đi</span></>
                        ) : (
                          <>🚫 <span>Không nên đi</span></>
                        )
                      )}
                    </div>
                  )}

                  <button className="del-btn" onClick={() => setSchedule(removeEvent(schedule, ev.id))} title="Xóa lịch trình">
                    <Trash size={16} />
                  </button>
                </div>
              );
            }) : <div className="empty">Không có lịch trình cho ngày này.</div>}
          </div>
        </div>
      </main>

      {/* modal lịch full screen */}
      {calendarModal && (
        <div className="modal-bg full-screen" onClick={() => setCalendarModal(false)}>
          <div className="modal-box full-calendar-box" onClick={e => e.stopPropagation()}>
            <button className="close-x" onClick={() => setCalendarModal(false)}><Plus size={24} style={{ transform: 'rotate(45deg)' }} /></button>
            <div className="full-cal-content">
              {/* bên trái: lịch */}
              <div className="cal-left">
                <div className="cal-header">
                  <div className="cal-selects">
                    <select
                      value={viewDate.getMonth()}
                      onChange={e => setViewDate(new Date(viewDate.getFullYear(), parseInt(e.target.value), 1))}
                      className="month-select"
                    >
                      {['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'].map((m, i) => (
                        <option key={i} value={i}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={viewDate.getFullYear()}
                      onChange={e => setViewDate(new Date(parseInt(e.target.value), viewDate.getMonth(), 1))}
                      className="year-select"
                    >
                      {Array.from({ length: 16 }, (_, i) => 2020 + i).map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="cal-nav">
                    <button onClick={() => setViewDate(subMonths(viewDate, 1))}><ChevronLeft size={18} /></button>
                    <button onClick={() => { setViewDate(new Date()); setSelectedDate(new Date()); }}>Hôm nay</button>
                    <button onClick={() => setViewDate(addMonths(viewDate, 1))}><ChevronRight size={18} /></button>
                  </div>
                </div>

                <div className="cal-grid">
                  {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => (
                    <div key={d} className="cal-weekday">{d}</div>
                  ))}
                  {(() => {
                    const start = startOfWeek(startOfMonth(viewDate), { weekStartsOn: 1 });
                    const end = endOfWeek(endOfMonth(viewDate), { weekStartsOn: 1 });
                    const days = eachDayOfInterval({ start, end });

                    return days.map(day => {
                      const dayEvents = schedule.filter(e => isSameDay(e.time, day));
                      const isSelected = isSameDay(day, selectedDate);
                      return (
                        <div
                          key={day.toISOString()}
                          className={`cal-day ${!isSameMonth(day, viewDate) ? 'other-month' : ''} ${isToday(day) ? 'today' : ''} ${dayEvents.length > 0 ? 'has-events' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedDate(day)}
                          onDoubleClick={() => {
                            const combined = new Date(day);
                            combined.setHours(now.getHours(), now.getMinutes());
                            setForm({ ...form, lat: undefined, lon: undefined, time: format(combined, "yyyy-MM-dd'T'HH:mm") });
                            setModal(true);
                          }}
                        >
                          <span className="day-number">{format(day, 'd')}</span>
                          <div className="day-events">
                            {dayEvents.slice(0, 3).map(ev => (
                              <div key={ev.id} className="mini-event-dot" title={ev.title} />
                            ))}
                            {dayEvents.length > 3 && <div className="mini-event-more">+{dayEvents.length - 3}</div>}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* bên phải: ds sự kiện */}
              <div className="cal-right">
                <div className="selected-day-header">
                  <div className="date-badge">
                    <span className="day-name">{format(selectedDate, 'EEEE', { locale: vi })}</span>
                    <span className="day-val">{format(selectedDate, 'd')}</span>
                    <span className="month-val">Tháng {format(selectedDate, 'MM, yyyy', { locale: vi })}</span>
                  </div>
                  <div className="day-panel-actions">
                    <button className="add-event-btn" onClick={() => {
                      const combined = new Date(selectedDate);
                      combined.setHours(now.getHours(), now.getMinutes());
                      setForm({ ...form, lat: undefined, lon: undefined, time: format(combined, "yyyy-MM-dd'T'HH:mm") });
                      setModal(true);
                    }}>
                      <Plus size={16} /> Thêm sự kiện
                    </button>
                    {schedule.length > 0 && (
                      <div className="clear-action-group">
                        <button className="clear-day-btn" onClick={() => handleClearDay(selectedDate)}>
                          <Trash size={14} /> 1 Ngày
                        </button>
                        <button className="clear-all-day-btn" onClick={handleClearAll}>
                          <Trash size={14} /> Tất cả
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="selected-day-events">
                  {(() => {
                    const dayEvents = schedule.filter(e => isSameDay(e.time, selectedDate));
                    return dayEvents.length > 0 ? dayEvents.sort((a, b) => {
                      const isAPast = a.time < now;
                      const isBPast = b.time < now;
                      if (isAPast && !isBPast) return 1;
                      if (!isAPast && isBPast) return -1;
                      return a.time.getTime() - b.time.getTime();
                    }).map(ev => {
                      // ko có data cho mọi ngày trg quá khứ/tương lai xa,
                      // chỉ phân tích nếu trg dải forecast (vd 5 ngày)
                      // hiện cơ bản cho dễ nhìn
                      return (
                        <div key={ev.id} className="mini-event-row">
                          <span className="time">{format(ev.time, 'HH:mm')}</span>
                          <div className="content">
                            <span className="title">{ev.title}</span>
                            {ev.location && <span className="loc"><MapPin size={10} /> {ev.location}</span>}
                          </div>
                          <button className="del-btn" onClick={() => setSchedule(removeEvent(schedule, ev.id))}><Trash size={14} /></button>
                        </div>
                      );
                    }) : (
                      <div className="no-events-box">
                        <Calendar size={40} />
                        <p>Không có sự kiện nào trong ngày này.</p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* modal thêm sự kiện */}
      {modal && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Thêm lịch trình</h3>
            <div className="form-group">
              <label>Tên công việc</label>
              <input type="text" placeholder="Ví dụ: Đi họp, Đi chơi..." value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Thời gian</label>
              <input type="datetime-local" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            </div>
            <div className="form-group" style={{ position: 'relative' }}>
              <label>Địa điểm đến</label>
              <input
                type="text"
                placeholder="Tìm địa chỉ: số nhà, đường, quận..."
                value={form.location}
                onChange={e => {
                  setForm({ ...form, location: e.target.value });
                  setShowFormSuggestions(true);
                }}
                onFocus={() => setShowFormSuggestions(true)}
                onBlur={() => setTimeout(() => setShowFormSuggestions(false), 200)}
              />
              {showFormSuggestions && formSuggestions.length > 0 && (
                <div className="suggestions-list modal-suggestions">
                  {formSuggestions.map((s, idx) => (
                    <div
                      key={`${s.id}-${idx}`}
                      className="suggestion-item"
                      onMouseDown={async (e) => {
                        e.preventDefault();
                        let finalLat: number | undefined = undefined;
                        let finalLon: number | undefined = undefined;
                        try {
                          const res = await fetch(`http://localhost:5000/api/place?id=${s.id}`);
                          const data = await res.json();
                          const feature = data.features?.[0];
                          if (feature?.geometry?.coordinates) {
                            [finalLon, finalLat] = feature.geometry.coordinates;
                          }
                        } catch (err) {
                          console.error("Failed to fetch place details", err);
                        }
                        setForm({ ...form, location: s.fullName, lat: finalLat, lon: finalLon });
                        setFormSuggestions([]);
                        setShowFormSuggestions(false);
                      }}
                    >
                      <span className="s-name">{s.name}</span>
                      <span className="s-admin">{s.sub}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={form.mandatory} onChange={e => setForm({ ...form, mandatory: e.target.checked })} />
              Bắt buộc phải đi
            </label>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setModal(false)}>Hủy</button>
              <button className="btn-primary" onClick={onAddEvent}>Lưu lịch trình</button>
            </div>
          </div>
        </div>
      )}
      {/* modal tải ics */}
      {icsLoading && (
        <div className="modal-bg" style={{ zIndex: 9999 }}>
          <div className="modal-box" style={{ textAlign: 'center', padding: '40px', alignItems: 'center', justifyContent: 'center' }}>
            <h3 style={{ marginBottom: '20px' }}>Đang tải dữ liệu file</h3>
            {icsProgress.total > 0 ? (
              <>
                <div style={{ width: '100%', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: '#a3a3a3' }}>
                    <span>Tra cứu tọa độ</span>
                    <span>{icsProgress.current}/{icsProgress.total}</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: '#262626', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${(icsProgress.current / icsProgress.total) * 100}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }}></div>
                  </div>
                </div>
                <p style={{ color: '#525252', fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📍 {icsProgress.locName}
                </p>
              </>
            ) : (
              <>
                <div className="spinner" style={{ marginBottom: '20px' }}></div>
                <p style={{ color: '#737373', fontSize: '13px' }}>Đang đọc file...</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
