# AI OmniNotes 開會記錄助手 — 智慧 P2P 多人連線會議中樞

AI OmniNotes 是一個**完全去中心化、無伺服器（Serverless）**的多人即時會議記錄與 AI 語音分析平台。透過 WebRTC 直接對等網路（Peer-to-Peer）與 MQTT 輕量化信令傳輸技術，各發言終端能夠將即時語音與文字直接傳輸給記錄主機端。結合本地瀏覽器 IndexedDB 儲存與 Gemini 大語言模型，實現免安裝、隱私安全、即時生成的數位會議助理。

[Demo](https://toydogcat.github.io/meeting-assistant/)

---

## 🛠 核心技術架構 (Core Technology Stack)

本專案採用現代 Web 技術與無伺服器對等通訊，完全免除後端資料庫與傳統伺服器儲存的依賴，大幅提升隱私保護與運作效率。

### 1. 去中心化 P2P 連線與信令傳遞 (Serverless WebRTC & MQTT)
- **WebRTC DataChannels**：主機端（Host）與發言端（Client）之間建立直接的對等連線，用以流式傳輸即時音訊數據（Audio stream arrays）與文字草稿，避免語音傳遞至任何第三方伺服器。
- **MQTT Signaling (over WebSockets)**：使用輕量級公共 MQTT 伺服器（預設為 `wss://broker.emqx.io:8084/mqtt`）作為 WebRTC 的連線信令交換管道（SDP / Candidates），免去建置與維護 Signaling Server 的成本。
- **8 碼房間識別號 (Room ID)**：隨機生成 8 碼英數字 Room ID，自動轉換為 MQTT 主題進行精準對接配對。
- **密碼式安全認證 (Password Gate)**：基於 SHA-256 雜湊的加密握手機制，訪客端連線時需經由主機端本地核對雜湊無誤後才允許建立 P2P 通道。

### 2. 本地端 AI 驅動引擎 (Client-Side Gemini Generative AI)
- **@google/genai SDK**：直接於客戶端網頁呼叫 Google Gemini Generative Language API。
- **客戶端語音轉文字 (STT)**：採用 `gemini-2.5-flash` 模型流式處理音訊二進位檔，實現免伺服器的中文與多語系語音識別。
- **大會即時摘要與分析**：背景排程增量執行 AI 摘要、代辦清單提取（Action Items）以及心智圖樹狀架構生成。
- **金鑰隱私保護**：Gemini API Key 與選擇的模型規格（如 `gemini-2.5-flash` 或 `gemini-2.5-pro`）僅儲存於用戶本機瀏覽器的 `localStorage` 中。

### 3. 客戶端本地持久化資料庫 (IndexedDB Engine)
- **原生 IndexedDB**：利用 HTML5 本地資料庫儲存完整的會議歷史紀錄（RoomSessions）與待審核提案（PendingAudits），提供近乎零延遲的調閱功能，重整或離線皆不遺失任何會議摘要。
- **內建資料初始化**：系統無資料時自動載入模擬歷史會議，方便開發與展示。

### 4. 前端渲染與豐富視覺 (Vite, React 19 & Tailwind v4)
- **Vite 6 + React 19 (TypeScript)**：極速開發建置環境與最新版 React 併發（Concurrent）底層支援。
- **Tailwind CSS v4**：利用全新的 `@tailwindcss/vite` 編譯器進行極速 CSS 處理與變數建置。
- **Framer Motion**：為設定模組（Settings Modal）、狀態提示、語音音量視覺化（Volume Indicator）提供順暢的微動畫（Micro-animations）。
- **Lucide Icons**：搭配現代高質感暗色調與玻璃擬物化（Glassmorphism）卡片視覺風格。

### 5. 整合與部署 (Integrations & CI/CD)
- **Vercount.one 訪問遙測**：在網頁頁尾整合 Vercount 客戶端計數器，即時統計 Site PV (Page Views) 與 Site UV (Unique Visitors)。
- **Iframe 捲動廣播**：當本系統嵌入為外部 portal Iframe 時，自動向父視窗發送 `iframe_scroll` 訊息，回傳 `scrollY` 與 `direction`，以配合外部頂欄進行動態收縮。
- **GitHub Actions 自動化部署**：配置 `.github/workflows/deploy.yml` 於代碼推送到 `main` 分支時自動執行 `npm run build` 並推播至 `gh-pages` 分支。

---

## 📦 本地快速啟動 (Local Quick Start)

### 準備工作
請確保您已安裝 [Node.js (v18+)](https://nodejs.org/)。

### 安裝步驟
1. 複製專案並安裝依賴：
   ```bash
   git clone <repository_url>
   cd meeting-assistant
   npm install
   ```

2. 啟動本機開發伺服器：
   ```bash
   npm run dev
   ```
   伺服器啟動後，瀏覽器打開 `http://localhost:5173/meeting-assistant/` 即可進行體驗。

3. 打包與靜態預覽：
   ```bash
   npm run build
   ```

---

## 🔒 隱私與安全性聲明 (Privacy & Security)
本系統所有即時音訊、文字討論以及分析報告：
1. **絕不**上傳至任何本平台管理的後端伺服器（無後端存儲）。
2. WebRTC 連線為直接點對端加密。
3. 您的 Gemini API Key 只存在您當前瀏覽器的 `localStorage` 內，安全不外洩。
