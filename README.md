# Should I Go Out? 🌤️

Ứng dụng dự báo thời tiết thông minh, giúp bạn quyết định có nên ra ngoài hay không dựa trên thời tiết thực tế và lịch trình cá nhân.

## ✨ Tính năng

- **Dự báo 7 ngày**: Xem thời tiết chi tiết theo từng giờ trong ngày
- **Phân tích thông minh**: Đánh giá mức độ an toàn (An toàn / Cẩn thận / Nguy hiểm) và điểm thoải mái
- **Lịch trình cá nhân**: Thêm sự kiện, đánh dấu bắt buộc/tự do, nhập file ICS
- **So sánh thời tiết**: So sánh thời tiết nơi ở và điểm đến khi có sự kiện
- **Tìm kiếm địa điểm**: Gợi ý tự động khi tìm thành phố hoặc địa chỉ
- **AI tư vấn**: Hỏi AI phân tích thời tiết và đưa lời khuyên cho ngày
- **Tự động định vị**: Lấy thời tiết nơi bạn đang ở (mặc định TP.HCM)

## 🛠 Công nghệ

- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express
- **Styling**: Vanilla CSS

## 📡 API sử dụng

### API miễn phí (không cần key)
| API | Mục đích |
|-----|----------|
| [Open-Meteo](https://open-meteo.com/) | Dữ liệu thời tiết chính (dự báo 7 ngày, theo giờ) |
| [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org/) | Reverse geocoding (tọa độ → tên địa điểm) |

### API cần key
| API | Mục đích | Lấy key ở đâu |
|-----|----------|----------------|
| [Openmap.vn](https://openmap.vn/) | Tìm kiếm & gợi ý địa điểm tại Việt Nam | Đăng ký tại [openmap.vn](https://openmap.vn/), vào Dashboard lấy API Key |
| [Groq](https://groq.com/) | AI phân tích thời tiết (model LLaMA) | Đăng ký tại [console.groq.com](https://console.groq.com/), tạo API Key trong mục API Keys |

## 🚀 Cài đặt

### 1. Clone repo
```bash
git clone https://github.com/itsmecoolhere/ShouldIGoOut.git
cd ShouldIGoOut
```

### 2. Cấu hình API Key

Tạo file `backend/.env` với nội dung:
```env
PORT=5000
OPENMAP_API_KEY=your_openmap_api_key_here
GROQ_API_KEY=your_groq_api_key_here
```

### 3. Chạy Backend
```bash
cd backend
npm install
node index.js
```
Backend chạy tại `http://localhost:5000`

### 4. Chạy Frontend
```bash
# Quay về thư mục gốc
cd ..
npm install
npm run dev
```
Frontend chạy tại `http://localhost:5173`

## 📁 Cấu trúc thư mục

```
shouldigoout/
├── backend/
│   ├── index.js          # Server Express, các API endpoint
│   ├── .env              # API keys (không push lên git)
│   └── package.json
├── src/
│   ├── App.tsx           # Component chính
│   ├── App.css           # Toàn bộ CSS
│   └── services/
│       ├── WeatherService.ts   # Xử lý dữ liệu thời tiết + phân tích
│       └── ScheduleService.ts  # Quản lý lịch trình (localStorage)
├── .gitignore
└── package.json
```
