/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MeetingSegment } from "../types";

// Supported models for the app
export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (推薦 - 極速)" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash (舊版穩定)" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (高品質)" }
];

export async function transcribeAudioClientSide(
  apiKey: string,
  base64Audio: string,
  rawMimeType: string,
  model: string = "gemini-2.5-flash",
  mode: "cloud" | "local" = "cloud"
): Promise<string> {
  if (mode === "local") {
    // Convert base64 to Blob for multipart upload
    const byteCharacters = atob(base64Audio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: rawMimeType });

    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

    const response = await fetch("http://localhost:8888/api/local/transcribe", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Local transcribe failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.text || "";
  }

  // Cloud Mode (Original logic)
  const mimeType = rawMimeType.split(";")[0];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: "請直接將以上的錄音逐字、精準地轉錄為繁體中文文字。請勿做任何解釋、意見闡述或摘要，僅輸出文字內容。若錄音無人說話，請直接回傳空字串。"
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Transcribe request failed: ${response.statusText}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || "";
}

export interface GeminiAnalysisResult {
  summary: string;
  todos: Array<{ text: string; assignee: string; category: string }>;
  mindmap: Array<{ id: string; label: string; parentId?: string; type?: "topic" | "detail" | "action" }>;
}

export async function analyzeMeetingClientSide(
  apiKey: string,
  segments: MeetingSegment[],
  model: string = "gemini-2.5-flash",
  mode: "cloud" | "local" = "cloud"
): Promise<GeminiAnalysisResult> {
  if (mode === "local") {
    const response = await fetch("http://localhost:8888/api/local/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transcripts: segments.map(s => ({ sender: s.sender, text: s.text }))
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local analysis failed: ${errorText}`);
    }

    return await response.json() as GeminiAnalysisResult;
  }

  // Cloud Mode (Original logic)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const transcriptText = segments
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

  const payload = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: { 
            type: "STRING", 
            description: "Markdown 格式的高質量、視覺排版精美的會議摘要與討論要點報告" 
          },
          todos: {
            type: "ARRAY",
            description: "從會議逐字稿中提取的所有具體待辦事項 list",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING", description: "具體待辦細項" },
                assignee: { type: "STRING", description: "執行此項目的負責人姓名，若未指明請設為 '未指定'" },
                category: { type: "STRING", description: "工作屬性，如 '前端'、'後端'、'設計'、'產品設計' 或 '市場拓展'" }
              },
              required: ["text", "assignee", "category"]
            }
          },
          mindmap: {
            type: "ARRAY",
            description: "結構化心智圖節點陣列，深度反映會議脈絡。",
            items: {
              type: "OBJECT",
              properties: {
                id: { type: "STRING", description: "節點唯一識別碼。根節點使用 'root'" },
                label: { type: "STRING", description: "節點顯示名稱" },
                parentId: { type: "STRING", description: "父級節點 id。如果是根節點則無此屬性。" },
                type: { type: "STRING", description: "節點類型：'topic' (核心話題)、'detail' (輔助資訊) 或 'action' (工作行點)" }
              },
              required: ["id", "label"]
            }
          }
        },
        required: ["summary", "todos", "mindmap"]
      }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Gemini analysis request failed: ${response.statusText}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty response from Gemini analysis");
  }

  return JSON.parse(text) as GeminiAnalysisResult;
}
