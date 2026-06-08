/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoomSession, PendingSubmission } from "../types";

const DB_NAME = "meeting_assistant_db";
const DB_VERSION = 1;

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB database."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains("rooms")) {
        db.createObjectStore("rooms", { keyPath: "roomId" });
      }
      if (!db.objectStoreNames.contains("submissions")) {
        db.createObjectStore("submissions", { keyPath: "id" });
      }
    };
  });
}

export async function getRooms(): Promise<RoomSession[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("rooms", "readonly");
    const store = transaction.objectStore("rooms");
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error("Failed to retrieve rooms from database."));
    };
  });
}

export async function getRoom(roomId: string): Promise<RoomSession | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("rooms", "readonly");
    const store = transaction.objectStore("rooms");
    const request = store.get(roomId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to retrieve room ${roomId} from database.`));
    };
  });
}

export async function saveRoom(room: RoomSession): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("rooms", "readwrite");
    const store = transaction.objectStore("rooms");
    const request = store.put(room);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to save room ${room.roomId} to database.`));
    };
  });
}

export async function deleteRoom(roomId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("rooms", "readwrite");
    const store = transaction.objectStore("rooms");
    const request = store.delete(roomId);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete room ${roomId} from database.`));
    };
  });
}

export async function getSubmissions(): Promise<PendingSubmission[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("submissions", "readonly");
    const store = transaction.objectStore("submissions");
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error("Failed to retrieve submissions from database."));
    };
  });
}

export async function saveSubmission(submission: PendingSubmission): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("submissions", "readwrite");
    const store = transaction.objectStore("submissions");
    const request = store.put(submission);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to save submission ${submission.id} to database.`));
    };
  });
}

export async function deleteSubmission(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("submissions", "readwrite");
    const store = transaction.objectStore("submissions");
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete submission ${id} from database.`));
    };
  });
}

// Seed helper to seed some initial rooms if database is completely empty
export async function seedDatabaseIfEmpty(): Promise<void> {
  const existingRooms = await getRooms();
  if (existingRooms.length > 0) return;

  const seedMeetings: RoomSession[] = [
    {
      roomId: "ROOM1111",
      title: "系統架構迭代與客戶端端點開發週會",
      meetingDate: "2026-06-03",
      createdTime: Date.now() - 5 * 24 * 60 * 60 * 1000,
      status: "completed",
      segments: [
        { id: "seg-1", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 1000, sender: "組長 (阿松)", text: "今天主要聚焦於架構調優，尤其是多模態語音逐字稿在移動端的高效拋轉。", isVoice: false },
        { id: "seg-2", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 5000, sender: "後端 (小明)", text: "我們已經開通了高效 REST API 和 WebSocket 超高速對等通道，後續會擴增 pending 審核隊列，讓終端直接拋轉語音包或打字留言。", isVoice: true },
        { id: "seg-3", timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 10000, sender: "前端 (小華)", text: "前端的部分我會設計精美的『提案發起上傳』控制閥。終端用戶可以錄音、打字，指派對應的審核類型與目標會議，再提交給主機端簽核。", isVoice: false }
      ],
      summary: `# 會議大綱：架構迭代與多端連線\n## 1. 核心決策與共識\n- 啟用伺服器端 in-memory 直連與持久性歷史回顧。\n- 終端發起的語音、文字等，均須透過**後端待辦審核機制**進行審核，提升紀錄嚴謹度。\n\n## 2. 移動端與主機交互鏈路\n* **即時音頻串流**：終端直接壓著按鈕錄音，將經過 P2P 通道或 WebSocket 秒級回傳。\n* **增量安全審查**：未經簽核的項目會存放在暫存庫，防止亂入發言。`,
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
      roomId: "ROOM2222",
      title: "語音降噪與 AI 辨識精準配對決策會議",
      meetingDate: "2026-06-05",
      createdTime: Date.now() - 3 * 24 * 60 * 60 * 1000,
      status: "completed",
      segments: [
        { id: "seg-10", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 1000, sender: "主持 (麗麗)", text: "這場主要討論音源壓縮及雜音過濾問題。Gemini 近期在多模態解析的速度大幅領先，但仍需消除環境高頻雜音。", isVoice: false },
        { id: "seg-11", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 12000, sender: "測試夥伴 (阿豪)", text: "目前測試，壓住按鈕錄音在 iOS 的 MimeType 為 audio/webm，在安卓部分為 mime audio/opus，轉由端點封裝後，辨識精確率達 98%。", isVoice: true }
      ],
      summary: `# 會議大綱：語音工程降噪會議\n## 1. 環境背景噪音診斷\n- 主辦辦公室多吹風雜音與空調高頻低噪。\n- 端點透過 WebAudio API 分析微秒振幅，進行增益控制。\n\n## 2. 直連語彙解算\n- 使用 **Gemini 2.5 Flash** 進行二進制直讀，免除繁複的語音分割，降低延遲。`,
      todos: [
        { id: "todo-10", text: "升級 Opus 音頻增益濾波器，預設降噪 15dB", assignee: "測試夥伴 (阿豪)", done: false, category: "測試與硬體" },
        { id: "todo-11", text: "整合並封裝端點 MimeType 多樣化相容方案", assignee: "後端 (小明)", done: true, category: "後端" }
      ],
      mindmap: [
        { id: "root", label: "降噪辨識會議", type: "topic" },
        { id: "n-20", label: "前端降噪", parentId: "root", type: "topic" },
        { id: "n-21", label: "WebAudio 濾波器", parentId: "n-20", type: "detail" },
        { id: "n-22", label: "Gemini 多模態直讀", parentId: "root", type: "topic" },
        { id: "n-23", label: "2.5 Flash 極速解算", parentId: "n-22", type: "action" }
      ],
      recordings: [
        { id: "rec-2", name: "noise_cancellation_test.mp3", timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, size: 8402200 }
      ]
    }
  ];

  for (const room of seedMeetings) {
    await saveRoom(room);
  }

  // Also seed some pending submissions
  const seedSubmissions: PendingSubmission[] = [
    {
      id: "sub-1",
      roomId: "ROOM1111",
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
      roomId: "ROOM1111",
      meetingTitle: "系統架構迭代與客戶端端點開發週會",
      type: "text",
      content: "補充說明：未來伺服器端開發將擴展至 PostgreSQL 多副本持久化，並藉由 Drizzle ORM 管理架構遷移。",
      submittedBy: "發言終端_E31FA",
      status: "pending",
      timestamp: Date.now() - 8 * 60 * 1000
    }
  ];

  for (const sub of seedSubmissions) {
    await saveSubmission(sub);
  }
}
