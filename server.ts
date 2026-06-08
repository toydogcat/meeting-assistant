/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import * as dotenv from "dotenv";
import { RoomSession, MeetingSegment, TodoItem, MindmapNode, PendingSubmission, MeetingRecording } from "./src/types";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// In-memory persistent database for meeting sessions
const rooms = new Map<string, RoomSession>();

// In-memory store for user-submitted proposals (pending queue)
const pendingSubmissions: PendingSubmission[] = [];

// Seed realistic dummy meetings to make history rich on startup
const seedMeetings: RoomSession[] = [
  {
    roomId: "ROOM1",
    title: "系統架構迭代與客戶端端點開發週會",
    meetingDate: "2026-06-03",
    createdTime: Date.now() - 5 * 24 * 60 * 60 * 1000,
    status: "completed",
    segments: [
      { id: "seg-1", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 1000, sender: "組長 (阿松)", text: "今天主要聚焦於架構調優，尤其是多模態語音逐字稿在移動端的高效拋轉。", isVoice: false },
      { id: "seg-2", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 5000, sender: "後端 (小明)", text: "我們已經開通了高效 REST API 和 WebSocket 超高速對等通道，後續會擴增 pending 審核隊列，讓終端直接拋轉語音包或打字留言。", isVoice: true },
      { id: "seg-3", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 10000, sender: "前端 (小華)", text: "前端的部分我會設計精美的『提案發起上傳』控制閥。終端用戶可以錄音、打字，指派對應的審核類型與目標會議，再提交給主機端簽核。", isVoice: false }
    ],
    summary: `# 會議大綱：架構迭代與多端連線
## 1. 核心決策與共識
- 啟用伺服器端 in-memory 直連與持久性歷史回顧。
- 終端發起的語音、文字等，均須透過**後端待辦審核機制**進行審核，提升紀錄嚴謹度。

## 2. 移動端與主機交互鏈路
* **即時音頻串流**：終端直接壓著按鈕錄音，將經過 P2P 通道或 WebSocket 秒級回傳。
* **增量安全審查**：未經簽核的項目會存放在暫存庫，防止亂入發言。`,
    todos: [
      { id: "todo-1", text: "完成 Pending 提案審核後端邏輯與 API 設計", assignee: "後端 (小明)", done: true, category: "後端" },
      { id: "todo-2", text: "開發前端可視化會議紀錄歷史面板與 PDF/JSON 下載組件", assignee: "前端 (小華)", done: true, category: "前端" },
      { id: "todo-3", text: "配合 Gemini API 優化文字稿語彙模型", assignee: "組長 (阿松)", done: false, category: "AI" }
    ],
    mindmap: [
      { id: "root", label: "架構迭代大會", type: "topic" },
      { id: "n-1", label: "數據直連網路", parentId: "root", type: "topic" },
      { id: "n-2", label: "WebRTC P2P 長鏈路", parentId: "n-1", type: "detail" },
      { id: "n-3", label: "提案待辦簽核機制", parentId: "root", type: "topic" },
      { id: "n-4", label: "審核通過方可保存", parentId: "n-3", type: "action" }
    ],
    recordings: [
      { id: "rec-1", name: "arch_week3_audio.wav", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000, size: 2341000 }
    ]
  },
  {
    roomId: "ROOM2",
    title: "語音降噪與 AI 辨識精準配對決策會議",
    meetingDate: "2026-06-05",
    createdTime: Date.now() - 3 * 24 * 60 * 60 * 1000,
    status: "completed",
    segments: [
      { id: "seg-10", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 1000, sender: "主持 (麗麗)", text: "這場主要討論音源壓縮及雜音過濾問題。Gemini 近期在多模態解析的速度大幅領先，但仍需消除環境高頻雜音。", isVoice: false },
      { id: "seg-11", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 12000, sender: "測試夥伴 (阿豪)", text: "目前測試，壓住按鈕錄音在 iOS 的 MimeType 為 audio/webm，在安卓部分為 mime audio/opus，轉由端點封裝後，辨識精確率達 98%。", isVoice: true }
    ],
    summary: `# 會議大綱：語音工程降噪會議
## 1. 環境背景噪音診斷
- 主辦辦公室多吹風雜音與空調高頻低噪。
- 端點透過 WebAudio API 分析微秒振幅，進行增益控制。

## 2. 直連語彙解算
- 使用 **Gemini 3.5 Flash** 進行二進制直讀，免除繁複的語音分割，降低延遲。`,
    todos: [
      { id: "todo-10", text: "升級 Opus 音頻增益濾波器，預設降噪 15dB", assignee: "測試夥伴 (阿豪)", done: false, category: "測試與硬體" },
      { id: "todo-11", text: "整合並封裝端點 MimeType 多樣化相容方案", assignee: "後端 (小明)", done: true, category: "後端" }
    ],
    mindmap: [
      { id: "root", label: "降噪辨識會議", type: "topic" },
      { id: "n-20", label: "前端降噪", parentId: "root", type: "topic" },
      { id: "n-21", label: "WebAudio 濾波器", parentId: "n-20", type: "detail" },
      { id: "n-22", label: "Gemini 多模態直讀", parentId: "root", type: "topic" },
      { id: "n-23", label: "3.5 Flash 極速解算", parentId: "n-22", type: "action" }
    ],
    recordings: [
      { id: "rec-2", name: "noise_cancellation_test.mp3", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, size: 8402200 }
    ]
  }
];

// Load seed data on startup
seedMeetings.forEach(r => rooms.set(r.roomId, r));

// Populate a few initial pending submissions in our audit logs for immediate feedback
pendingSubmissions.push(
  {
    id: "sub-1",
    roomId: "ROOM1",
    meetingTitle: "系統架構迭代與客戶端端點開發週會",
    type: "todo",
    content: "在會議紀錄首頁追加 PDF / Markdown 全文一件導出與備份按鈕",
    submittedBy: "發言終端_5A9D2",
    status: "pending",
    timestamp: Date.now() - 15 * 60 * 1000,
    additionalInfo: {
      category: "前端",
      assignee: "前端 (小華)"
    }
  },
  {
    id: "sub-2",
    roomId: "ROOM1",
    meetingTitle: "系統架構迭代與客戶端端點開發週會",
    type: "text",
    content: "補充說明：未來伺服器端開發將擴展至 PostgreSQL 多副本持久化，並藉由 Drizzle ORM 管理架構遷移。",
    submittedBy: "發言終端_E31FA",
    status: "pending",
    timestamp: Date.now() - 8 * 60 * 1000
  }
);

// Initialize Gemini Client Lazily to prevent crash on startup if API key is missing
let aiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is missing. Please configure it in Settings > Secrets to enable meeting analysis.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiInstance;
}

// REST API Endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", apiConfigured: !!process.env.GEMINI_API_KEY });
});

// List all meetings with meta summary for index dashboard
app.get("/api/meetings", (req, res) => {
  const list = Array.from(rooms.values()).map(r => ({
    roomId: r.roomId,
    title: r.title || `會議室 ${r.roomId}`,
    meetingDate: r.meetingDate || new Date(r.createdTime).toISOString().split("T")[0],
    createdTime: r.createdTime,
    status: r.status,
    segmentsCount: r.segments.length,
    todosCount: r.todos.length,
    mindmapCount: r.mindmap.length,
    recordingsCount: (r.recordings || []).length,
    passwordProtected: !!r.password
  }));
  res.json(list);
});

// Create a new custom meeting with customized date/title and optional room password
app.post("/api/meetings", (req, res) => {
  const { title, meetingDate, roomId: rawRoomId, password } = req.body;
  const roomId = (rawRoomId || Math.random().toString(36).substring(2, 7).toUpperCase()).trim().toUpperCase();

  const newRoom: RoomSession = {
    roomId,
    title: title || `新會議 ${roomId}`,
    meetingDate: meetingDate || new Date().toISOString().split("T")[0],
    createdTime: Date.now(),
    status: "active",
    segments: [],
    summary: "# 智庫分析報告\n*等待語音或文字注入中...*",
    todos: [],
    mindmap: [
      { id: "root", label: title || `會議：${roomId}`, type: "topic" }
    ],
    recordings: [],
    password: password || undefined,
    passwordProtected: !!password
  };

  rooms.set(roomId, newRoom);
  res.status(201).json(newRoom);
});

// Verify room access password
app.post("/api/rooms/:roomId/verify", (req, res) => {
  const { roomId } = req.params;
  const { password } = req.body;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "ROOM_NOT_FOUND", message: "找不到該會議房號！" });
  }
  if (room.password && room.password !== password) {
    return res.status(401).json({ error: "PASSWORD_INVALID", message: "會議密碼錯誤，請重新確認！" });
  }
  res.json({ success: true, title: room.title, passwordProtected: !!room.password });
});

// Get room details (compatible with existing)
app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  res.json(room);
});

// Bulk update/edit a specific meeting from manual upload or UI forms
app.put("/api/meetings/:roomId", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const { title, meetingDate, summary, todos, mindmap, segments, recordings } = req.body;

  if (title !== undefined) room.title = title;
  if (meetingDate !== undefined) room.meetingDate = meetingDate;
  if (summary !== undefined) room.summary = summary;
  if (todos !== undefined) room.todos = todos;
  if (mindmap !== undefined) room.mindmap = mindmap;
  if (segments !== undefined) room.segments = segments;
  if (recordings !== undefined) room.recordings = recordings;

  rooms.set(roomId, room);
  broadcastToRoom(roomId, { type: "sync", session: room });
  res.json({ message: "Meeting updated successfully", session: room });
});

// Upload recordings to a specific meeting
app.post("/api/meetings/:roomId/upload-audio", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const { name, size, base64Data } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Filename required" });
  }

  const recording: MeetingRecording = {
    id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
    name,
    timestamp: Date.now(),
    size: size || (base64Data ? Math.floor(base64Data.length * 0.75) : 0),
    base64Data
  };

  if (!room.recordings) room.recordings = [];
  room.recordings.push(recording);
  rooms.set(roomId, room);

  broadcastToRoom(roomId, { type: "sync", session: room });
  res.json({ message: "Audio recording uploaded successfully", recording });
});

// Force meeting summarization and analysis (compatible with existing)
app.post("/api/rooms/:roomId/analyze", async (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  if (room.segments.length === 0) {
    return res.json({ message: "No meeting segments yet to analyze.", session: room });
  }

  try {
    room.status = "analyzing";
    broadcastToRoom(roomId, { type: "sync", session: room });

    const updatedRoom = await analyzeRoomWithGemini(room);
    rooms.set(roomId, updatedRoom);
    
    broadcastToRoom(roomId, { type: "sync", session: updatedRoom });
    res.json(updatedRoom);
  } catch (error: any) {
    console.error("Gemini meeting analysis failed:", error);
    room.status = "active";
    broadcastToRoom(roomId, { type: "sync", session: room });
    res.status(500).json({ error: error.message || "Meeting analysis failed" });
  }
});

// Clear room session data (compatible with existing)
app.post("/api/rooms/:roomId/reset", (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (room) {
    room.segments = [];
    room.summary = "";
    room.todos = [];
    room.mindmap = [
      { id: "root", label: room.title || `會議：${roomId}`, type: "topic" }
    ];
    room.status = "active";
    room.recordings = [];
    rooms.set(roomId, room);
    broadcastToRoom(roomId, { type: "sync", session: room });
  }
  res.json({ message: "Room session reset successfully", session: room });
});

// Retrieve pending suggestions & creations
app.get("/api/submissions", (req, res) => {
  res.json(pendingSubmissions);
});

// Clients can submit suggestions & uploads for specific parts of specific meetings
app.post("/api/submissions", (req, res) => {
  const { roomId, type, content, submittedBy, additionalInfo } = req.body;
  if (!roomId || !type || !content) {
    return res.status(400).json({ error: "Missing roomId, type, or content" });
  }

  const room = rooms.get(roomId);
  const meetingTitle = room ? (room.title || `會議 ${roomId}`) : `未知會議室 ${roomId}`;

  const submission: PendingSubmission = {
    id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    roomId,
    meetingTitle,
    type,
    content,
    submittedBy: submittedBy || "匿名發言端",
    status: "pending",
    timestamp: Date.now(),
    additionalInfo
  };

  pendingSubmissions.push(submission);
  // Notify host live that a new suggestion has arrived
  broadcastToRoom(roomId, { type: "new-submission-alert", submission });

  res.status(201).json(submission);
});

// Audit and review proposals (Approved / Rejected)
app.post("/api/submissions/:id/review", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // "approved" or "rejected"

  if (status !== "approved" && status !== "rejected") {
    return res.status(400).json({ error: "Status must be approved or rejected" });
  }

  const idx = pendingSubmissions.findIndex(s => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Submission not found" });
  }

  const sub = pendingSubmissions[idx];
  sub.status = status;

  if (status === "approved") {
    const room = rooms.get(sub.roomId);
    if (room) {
      if (sub.type === "todo") {
        const text = sub.content;
        const assignee = sub.additionalInfo?.assignee || "未指定";
        const category = sub.additionalInfo?.category || "智庫";
        room.todos.push({
          id: `todo-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          text,
          assignee,
          category,
          done: false
        });
      } else if (sub.type === "text") {
        room.segments.push({
          id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          timestamp: Date.now(),
          sender: sub.submittedBy || "發言端建議",
          text: sub.content,
          isVoice: false
        });
      } else if (sub.type === "voice") {
        // If voice suggestions, transcribe from cached base64 content
        try {
          const transcribed = await transcribeVoiceChunk(sub.content, sub.additionalInfo?.voiceMime);
          if (transcribed && transcribed.trim()) {
            room.segments.push({
              id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
              timestamp: Date.now(),
              sender: `${sub.submittedBy} (語音錄製)`,
              text: transcribed,
              isVoice: true
            });
          } else {
            room.segments.push({
              id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
              timestamp: Date.now(),
              sender: `${sub.submittedBy} (語音錄製)`,
              text: `[空白或靜音語音]`,
              isVoice: true
            });
          }
        } catch (e: any) {
          console.error("Transcription on review failed:", e);
          // Fallback to uploading segment placeholder
          room.segments.push({
            id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
            timestamp: Date.now(),
            sender: `${sub.submittedBy} (語音錄製)`,
            text: `[語音未能解析]: ${e.message}`,
            isVoice: true
          });
        }
      } else if (sub.type === "summary") {
        room.summary = (room.summary || '') + "\n\n" + sub.content;
      } else if (sub.type === "mindmap") {
        room.mindmap.push({
          id: `n-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          label: sub.content,
          parentId: sub.additionalInfo?.parentId || "root",
          type: sub.additionalInfo?.nodeType || "detail"
        });
      }

      rooms.set(sub.roomId, room);
      // Synchronize live clients and screens
      broadcastToRoom(sub.roomId, { type: "sync", session: room });
    }
  }

  // Remove elements or keep historic record
  res.json({ message: `Submission reviewed as ${status}`, submission: sub });
});

// Core logic: Call Gemini 3.5 Flash to generate Structured summary, Action items & Mindmap
async function analyzeRoomWithGemini(room: RoomSession): Promise<RoomSession> {
  const ai = getGeminiClient();
  
  const transcriptText = room.segments
    .map(seg => `[${new Date(seg.timestamp).toLocaleTimeString()}] ${seg.sender}: ${seg.text}`)
    .join("\n");

  const prompt = `你是一位專業且極其優秀的會議記錄與商業分析專家。請根據下方提供的會議記錄（發言與時間戳記），進行精確並結構化的整理。

請注意以下要求：
1. **會議摘要 (summary)**: 撰寫一份結構清晰、重點突出且排版極佳的 Markdown 格式會議大綱。應包含會議主旨、核心議題、重要論點、結論與下一步工作計畫。用富有專業感的形式包裝。
2. **行動清單 (todos)**: 提取出所有明確提出、或者暗示需要去完成的待辦任務。每個人務必標明負責人 (assignee，若無明確指出則填寫 "未指定")，以及其適當的領域分類 (category，例如：前端、後端、設計、產品企劃、行銷、營運等)。
3. **即時心智圖 (mindmap)**: 將會議深入探索的關聯概念，整理成適配心智圖表示的結構樹。
   - 根節點的 \`id\` 必須始終是 "root"。根節點的 \`label\` 為本月或本會議的核心主題（例如 "會議核心目標" ）。
   - 其他每一層子節點，請指定學理上正確的 \`parentId\`。
   - 節點類型 \`type\` 的可能值為: "topic" (主題), "detail" (細節資訊) 或 "action" (需要執行的任務)。

以下是目前的會議逐字記錄：
---
${transcriptText}
---`;

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { 
            type: Type.STRING, 
            description: "Markdown 格式的高質量、視覺排版精美的會議摘要與討論要點報告" 
          },
          todos: {
            type: Type.ARRAY,
            description: "從會議逐字稿中提取的所有具體待辦事項 list",
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING, description: "具體待辦細項" },
                assignee: { type: Type.STRING, description: "執行此項目的負責人姓名，若未指明請設為 '未指定'" },
                category: { type: Type.STRING, description: "工作屬性，如 '前端'、'後端'、'設計'、'產品設計' 或 '市場拓展'" }
              },
              required: ["text", "assignee", "category"]
            }
          },
          mindmap: {
            type: Type.ARRAY,
            description: "結構化心智圖節點陣列，深度反映會議脈絡。",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "節點唯一識別碼。根節點使用 'root'" },
                label: { type: Type.STRING, description: "節點顯示名稱" },
                parentId: { type: Type.STRING, description: "父級節點 id。如果是根節點則無此屬性。" },
                type: { type: Type.STRING, description: "節點類型：'topic' (核心話題)、'detail' (輔助資訊) 或 'action' (工作行點)" }
              },
              required: ["id", "label"]
            }
          }
        },
        required: ["summary", "todos", "mindmap"]
      }
    }
  });

  const parsed = JSON.parse(response.text?.trim() || "{}");

  return {
    ...room,
    status: "active",
    summary: parsed.summary || "未生成有效摘要",
    todos: (parsed.todos || []).map((t: any, index: number) => ({
      ...t,
      id: `todo-${Date.now()}-${index}`,
      done: false
    })),
    mindmap: parsed.mindmap || []
  };
}

// Create HTTP and WebSocket Server
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

interface WebSocketConnection {
  ws: WebSocket;
  role: "host" | "client" | "cohost";
  roomId: string;
  clientId: string;
}

const connections = new Set<WebSocketConnection>();

// Signaling & Realtime updates socket connection
wss.on("connection", (ws: WebSocket) => {
  let connInfo: WebSocketConnection | null = null;

  ws.on("message", async (messageStr: string) => {
    try {
      const data = JSON.parse(messageStr);

      // Handle connection registration
      if (data.type === "register") {
        const { role, roomId, clientId, password } = data;
        
        // Retrieve or initialize RoomSession
        let room = rooms.get(roomId);
        
        // Enforce password security during WebSocket connection
        if (room && room.password && room.password !== password) {
          ws.send(JSON.stringify({ 
            type: "error", 
            code: "AUTH_REQUIRED", 
            message: "房門安全密碼不符，WebSocket 直連通道拒絕連線！" 
          }));
          ws.close();
          return;
        }

        connInfo = {
          ws,
          role,
          roomId,
          clientId: clientId || `client-${Math.random().toString(36).substr(2, 9)}`
        };
        connections.add(connInfo);

        console.log(`[WebSocket] ${role} registered in Room ${roomId} (Client ID: ${connInfo.clientId})`);

        if (!room) {
          room = {
            roomId,
            createdTime: Date.now(),
            status: "active",
            segments: [],
            summary: "等待語音或文字輸入中...",
            todos: [],
            mindmap: [
              { id: "root", label: `會議：${roomId}`, type: "topic" }
            ],
            password: password || undefined,
            passwordProtected: !!password
          };
          rooms.set(roomId, room);
        }

        // Notify client about success and stream current room state
        ws.send(JSON.stringify({ type: "registered", clientId: connInfo.clientId, session: room }));

        // If client, notify host of new entrant for WebRTC setup
        if (role === "client") {
          broadcastToRoom(roomId, {
            type: "client-joined",
            roomId,
            clientId: connInfo.clientId
          }, connInfo.clientId);
        }
        return;
      }

      if (!connInfo) {
        ws.send(JSON.stringify({ type: "error", message: "Not registered yet." }));
        return;
      }

      const { roomId, clientId } = connInfo;

      // Realtime Audio Stream Fallback Handler
      if (data.type === "voice-chunk") {
        const { audioData, mimeType } = data;
        console.log(`[Audio Stream Log] Room ${roomId} is processing a voice segment from ${clientId}`);

        try {
          const text = await transcribeVoiceChunk(audioData, mimeType);
          if (text && text.trim().length > 0) {
            console.log(`[Transcription Done] ${text}`);
            
            const segment: MeetingSegment = {
              id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              timestamp: Date.now(),
              sender: connInfo.role === "host" ? "記錄主機" : connInfo.role === "cohost" ? `協同主控 (${clientId.slice(0, 5)})` : `發言端 (${clientId.slice(0, 5)})`,
              text,
              isVoice: true
            };

            const room = rooms.get(roomId);
            if (room) {
              room.segments.push(segment);
              rooms.set(roomId, room);
              
              // Broadcast segment in realtime to both UI ends
              broadcastToRoom(roomId, { type: "new-segment", segment });

              // Auto triggering lazy-reanalysis after a timeout (debounce) to keep layout live
              lazyRefreshRoom(roomId);
            }
          }
        } catch (err: any) {
          console.error("Transcribing audio error:", err);
          ws.send(JSON.stringify({ type: "error", message: `Gemini voice compilation warning: ${err.message}` }));
        }
        return;
      }

      // Handle user text notes input
      if (data.type === "text-chunk") {
        const { text } = data;
        if (text && text.trim()) {
          const segment: MeetingSegment = {
            id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            timestamp: Date.now(),
            sender: connInfo.role === "host" ? "記錄主機" : connInfo.role === "cohost" ? `協同主控 (${clientId.slice(0, 5)})` : `發言端 (${clientId.slice(0, 5)})`,
            text,
            isVoice: false
          };

          const room = rooms.get(roomId);
          if (room) {
            room.segments.push(segment);
            rooms.set(roomId, room);

            broadcastToRoom(roomId, { type: "new-segment", segment });
            lazyRefreshRoom(roomId);
          }
        }
        return;
      }

      // WebRTC Signaling Exchange: Route message directly to counterparts in the same room
      if (["offer", "answer", "candidate"].includes(data.type)) {
        // Broadcast signaling to other peers in the room
        connections.forEach(peer => {
          if (peer.roomId === roomId && peer.clientId !== clientId) {
            peer.ws.send(JSON.stringify(data));
          }
        });
        return;
      }

      // Keepalive ping handshake
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

    } catch (e: any) {
      console.error("[WebSocket Error]", e);
    }
  });

  ws.on("close", () => {
    if (connInfo) {
      connections.delete(connInfo);
      console.log(`[WebSocket] ${connInfo.role} disconnected client: ${connInfo.clientId}`);
      if (connInfo.role === "client") {
        broadcastToRoom(connInfo.roomId, {
          type: "client-left",
          clientId: connInfo.clientId
        });
      }
    }
  });
});

// Broadcast event helpers
function broadcastToRoom(roomId: string, payload: any, skipClientId?: string) {
  connections.forEach(conn => {
    if (conn.roomId === roomId) {
      if (skipClientId && conn.clientId === skipClientId) return;
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify(payload));
      }
    }
  });
}

// Debounce-assisted lazy analyzer that invokes Gemini in the background to avoid heavy-load overlapping
const scheduledAnalysis = new Map<string, NodeJS.Timeout>();
function lazyRefreshRoom(roomId: string) {
  const existingTimer = scheduledAnalysis.get(roomId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    scheduledAnalysis.delete(roomId);
    const room = rooms.get(roomId);
    if (room && room.segments.length > 0) {
      try {
        console.log(`[Lazy Analyst] Auto compilation start for room ${roomId}`);
        room.status = "recording";
        const updated = await analyzeRoomWithGemini(room);
        rooms.set(roomId, updated);
        broadcastToRoom(roomId, { type: "sync", session: updated });
        console.log(`[Lazy Analyst] Completed compilation for room ${roomId}`);
      } catch (err) {
        console.error(`[Lazy Analyst] Failed background generation:`, err);
      }
    }
  }, 4000); // Wait 4 seconds for user to finish stream of actions before re-structuring

  scheduledAnalysis.set(roomId, timer);
}

// Multi-modal binary audio transcribing using recommended Gemini 3.5 Flash
async function transcribeVoiceChunk(base64Audio: string, rawMimeType?: string): Promise<string> {
  const ai = getGeminiClient();
  
  // Clean up mimeType for security
  const mimeType = rawMimeType || "audio/webm";

  const audioPart = {
    inlineData: {
      mimeType: mimeType.split(";")[0], // Strip any codec tags which can error the payload builder
      data: base64Audio
    }
  };

  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      audioPart,
      "請直接將以上的錄音逐字、精準地轉錄為繁體中文文字。請勿做任何解釋、意見闡述或摘要，僅輸出文字內容。若錄音無人說話，請直接回傳空字串。"
    ]
  });

  return response.text || "";
}

// Set up server upgrade listener for handling both HTTP requests and WebSocket signaling upgrades
httpServer.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
  if (pathname === "/api/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Configure Vite middleware mapping client-side hot-loading in visual staging environments
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Meeting Record Server] Running on http://localhost:${PORT}`);
  });
}

start();
