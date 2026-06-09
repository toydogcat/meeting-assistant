/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { 
  Mic, Send, RefreshCw, Layers, Users, Sparkles, Copy, Check, CheckSquare, 
  Square, ArrowLeft, Wifi, Terminal, ShieldAlert, Cpu, Heart, AlertCircle, Trash2, 
  PhoneCall, Play, SquareTerminal, HelpCircle, Calendar, FileText, Download, X,
  PlusCircle, Pencil, Save, Plus, ChevronRight, FileUp, Settings, Sliders
} from "lucide-react";
import { Role, RoomSession, MeetingSegment, TodoItem, MindmapNode, PendingSubmission, MeetingRecording } from "./types";
import { motion, AnimatePresence } from "motion/react";
import { useP2PLink } from "./hooks/useP2PLink";
import { 
  getRooms, getRoom, saveRoom, deleteRoom, 
  getSubmissions, saveSubmission, deleteSubmission, 
  seedDatabaseIfEmpty 
} from "./utils/db";
import { transcribeAudioClientSide, analyzeMeetingClientSide, GEMINI_MODELS } from "./utils/gemini";
import { HomeView } from "./components/HomeView";
import { ClientTerminal } from "./components/ClientTerminal";
import { HostDashboard } from "./components/HostDashboard";
import { SettingsModal } from "./components/SettingsModal";
import { PasswordGate } from "./components/PasswordGate";
import { useSettings } from "./hooks/useSettings";
import { useAudioRecorder } from "./hooks/useAudioRecorder";

export default function App() {
  // Navigation & session state
  const [role, setRole] = useState<Role>("none");
  const [roomId, setRoomId] = useState("");
  const [clientId, setClientId] = useState(() => {
    let id = localStorage.getItem("meeting_assistant_client_id");
    if (!id) {
      id = `client-${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem("meeting_assistant_client_id", id);
    }
    return id;
  });
  const [clientName, setClientName] = useState(() => {
    return localStorage.getItem("meeting_assistant_client_name") || "發言終端";
  });
  const [session, setSession] = useState<RoomSession | null>(null);

  // Connection & Diagnostics
  const [diagnosticsLog, setDiagnosticsLog] = useState<string[]>([]);
  const [apiHealth, setApiHealth] = useState<{ alive: boolean; keyConfigured: boolean }>({ alive: true, keyConfigured: false });

  // User input states
  const [inputText, setInputText] = useState("");
  const [isCoping, setIsCopying] = useState(false);

  // AI Settings configuration hook
  const {
    geminiApiKey,
    setGeminiApiKey,
    selectedModel,
    setSelectedModel,
    aiMode,
    setAiMode
  } = useSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Microphone audio capture hook
  const {
    isRecording,
    voiceVolume,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording
  } = useAudioRecorder();


  // Log diagnostic events
  const addLog = useCallback((msg: string) => {
    console.log(`[Diagnostic] ${msg}`);
    const time = new Date().toLocaleTimeString();
    setDiagnosticsLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 40));
  }, []);

  // Update Gemini configuration health
  useEffect(() => {
    setApiHealth({ alive: true, keyConfigured: aiMode === "local" || !!geminiApiKey });
  }, [geminiApiKey, aiMode]);

  // Parse URL queries on startup for instant pair-up qr code scanning and initialize DB
  useEffect(() => {
    const initApp = async () => {
      // Seed IndexedDB if it is empty
      try {
        await seedDatabaseIfEmpty();
        await fetchMeetingsList();
        await fetchPendingAudits();
      } catch (err) {
        console.error("Failed to initialize local DB", err);
      }

      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get("roomId");
      const roleParam = params.get("role");
      const nameParam = params.get("name");
      
      if (nameParam) {
        setClientName(nameParam);
        localStorage.setItem("meeting_assistant_client_name", nameParam);
      }

      if (roomParam) {
        const cleanRoomId = roomParam.toUpperCase().trim();
        setRoomId(cleanRoomId);
        const targetRole = (roleParam === "cohost" || roleParam === "client" || roleParam === "host") ? (roleParam as Role) : "client";
        
        // Attempt authentication flow
        attemptJoinRoom(targetRole, cleanRoomId);
      }
    };

    initApp();
  }, [addLog]);

  // Iframe scroll message broadcaster
  useEffect(() => {
    let lastScrollY = window.scrollY;
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const direction = currentScrollY > lastScrollY ? "down" : "up";
      window.parent.postMessage({
        type: "iframe_scroll",
        scrollY: currentScrollY,
        direction: direction
      }, "*");
      lastScrollY = currentScrollY;
    };
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Persistent History and Auditing UI states
  const [hostTab, setHostTab] = useState<"live" | "history" | "audit">("live");
  const [meetingsList, setMeetingsList] = useState<any[]>([]);
  const [pendingAudits, setPendingAudits] = useState<PendingSubmission[]>([]);
  const [selectedHistoryMeeting, setSelectedHistoryMeeting] = useState<RoomSession | null>(null);

  // Client proposal forms states
  const [clientSection, setClientSection] = useState<"remote-speak" | "history-browse" | "propose-center">("remote-speak");
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientSubmitSuccessMsg, setClientSubmitSuccessMsg] = useState("");
  const [submitRoomId, setSubmitRoomId] = useState("");
  const [submitType, setSubmitType] = useState<"voice" | "todo" | "text" | "summary" | "mindmap">("text");
  const [submitContent, setSubmitContent] = useState("");
  const [submitSender, setSubmitSender] = useState("");
  
  // Custom todo proposals specific elements
  const [todoAssignee, setTodoAssignee] = useState("");
  const [todoCategory, setTodoCategory] = useState("智庫");
  const [mindmapParentId, setMindmapParentId] = useState("root");
  const [mindmapNodeType, setMindmapNodeType] = useState<"topic" | "detail" | "action">("detail");



  // Password-gated room and authentication states
  const [passwordGateOpen, setPasswordGateOpen] = useState(false);
  const [passwordGateRoomId, setPasswordGateRoomId] = useState("");
  const [passwordGateRole, setPasswordGateRole] = useState<Role>("none");
  const [passwordGateInput, setPasswordGateInput] = useState("");
  const [passwordGateError, setPasswordGateError] = useState("");
  const [roomStoredPassword, setRoomStoredPassword] = useState(""); // Used to persist authenticated password for P2P session

  // Client role connection option choice (Transmitter or Co-Host Controller)
  const [clientRoleChoice, setClientRoleChoice] = useState<"client" | "cohost">("client");

  // Room Creation / Host Setup Form configuration
  const [showHostSetupForm, setShowHostSetupForm] = useState(false);
  const [setupTitle, setSetupTitle] = useState("");
  const [setupDate, setSetupDate] = useState(new Date().toISOString().split("T")[0]);
  const [setupRoomId, setSetupRoomId] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupUsePassword, setSetupUsePassword] = useState(false);
  const [creatingMeeting, setCreatingMeeting] = useState(false);

  // Standalone decoupled sub-tab selection


  // Loaders
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [isLoadingAudits, setIsLoadingAudits] = useState(false);





  const fetchMeetingsList = async () => {
    try {
      setIsLoadingMeetings(true);
      const rooms = await getRooms();
      setMeetingsList(rooms);
    } catch (e) {
      console.error("Failed to load meetings", e);
    } finally {
      setIsLoadingMeetings(false);
    }
  };

  const fetchPendingAudits = async () => {
    try {
      setIsLoadingAudits(true);
      const subs = await getSubmissions();
      setPendingAudits(subs);
    } catch (e) {
      console.error("Failed to load suggestions", e);
    } finally {
      setIsLoadingAudits(false);
    }
  };

  const loadHistoryMeetingDetail = async (targetRoomId: string) => {
    try {
      const room = await getRoom(targetRoomId);
      if (room) {
        setSelectedHistoryMeeting(room);
      }
    } catch (e) {
      console.error("Failed to get meeting detail", e);
    }
  };

  const createNewHistoricalMeeting = async (customTitle?: string, customDate?: string) => {
    try {
      const newRoomId = Math.random().toString(36).substring(2, 10).toUpperCase(); // 8 characters!
      const newMeeting: RoomSession = {
        roomId: newRoomId,
        title: customTitle || `新會議室_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        meetingDate: customDate || new Date().toISOString().split("T")[0],
        createdTime: Date.now(),
        status: "active",
        segments: [],
        summary: "",
        todos: [],
        mindmap: [],
        recordings: []
      };
      
      await saveRoom(newMeeting);
      addLog(`成功創建新歷史會期：${newMeeting.title}`);
      await fetchMeetingsList();
      await loadHistoryMeetingDetail(newMeeting.roomId);
    } catch (e) {
      console.error("Failed to create historical session", e);
    }
  };

  const saveMeetingModification = async (targetRoomId: string, updatedFields: Partial<RoomSession>) => {
    try {
      const room = await getRoom(targetRoomId);
      if (room) {
        const updatedRoom = { ...room, ...updatedFields };
        await saveRoom(updatedRoom);
        
        if (selectedHistoryMeeting && selectedHistoryMeeting.roomId === targetRoomId) {
          setSelectedHistoryMeeting(updatedRoom);
        }
        if (session && session.roomId === targetRoomId) {
          setSession(updatedRoom);
          if (broadcastMessageRef.current) {
            broadcastMessageRef.current({ type: "sync", session: updatedRoom });
          }
        }
        addLog(`會議記錄儲存成功：${targetRoomId}`);
        await fetchMeetingsList();
      }
    } catch (e) {
      console.error("Failed to save meeting adjustments", e);
    }
  };

  const handleAudioFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetRoomId: string, isHistoryView = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    addLog(`編解碼語音上傳中：${file.name} (${Math.round(file.size / 1024)} KB)`);
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      try {
        const room = await getRoom(targetRoomId);
        if (room) {
          const newRecording: MeetingRecording = {
            id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: file.name,
            timestamp: Date.now(),
            size: file.size,
            base64Data
          };
          
          const updatedRecordings = [...(room.recordings || []), newRecording];
          const updatedRoom = { ...room, recordings: updatedRecordings };
          await saveRoom(updatedRoom);
          
          addLog(`音訊檔案 ${file.name} 已成功附加至 IndexedDB 資料庫！`);
          if (isHistoryView) {
            await loadHistoryMeetingDetail(targetRoomId);
          } else {
            setSession(updatedRoom);
            if (broadcastMessageRef.current) {
              broadcastMessageRef.current({ type: "sync", session: updatedRoom });
            }
          }
          await fetchMeetingsList();
        } else {
          alert("找不到指定的會議記錄。");
        }
      } catch (err) {
        console.error("Audio upload error", err);
        alert("附加音訊檔案發生錯誤。");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleTranscriptFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetRoomId: string, isHistoryView = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    addLog(`讀取文字稿上傳: ${file.name}`);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text || !text.trim()) return;

      const lines = text.split("\n").filter(l => l.trim() !== "");
      const newSegments = lines.map((line, idx) => {
        let sender = "導入段落";
        let content = line;
        const match = line.match(/^([^：:]{1,15})[：:](.*)$/);
        if (match) {
          sender = match[1].trim();
          content = match[2].trim();
        }
        return {
          id: `seg-import-${Date.now()}-${idx}`,
          timestamp: Date.now() + idx * 100,
          sender,
          text: content,
          isVoice: false
        };
      });

      try {
        const room = await getRoom(targetRoomId);
        if (room) {
          const mergedSegments = [...(room.segments || []), ...newSegments];
          await saveMeetingModification(targetRoomId, { segments: mergedSegments });
          addLog(`成功上傳並解析導入 ${newSegments.length} 條詳細文字稿段落！`);
        }
      } catch (err) {
        console.error("Transcript parsing error", err);
      }
    };
    reader.readAsText(file);
  };

  const submitProposalFromClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submitRoomId || !submitContent.trim()) {
      alert("請指定目標會議並填寫提案內容！");
      return;
    }
    setClientSubmitting(true);
    setClientSubmitSuccessMsg("");
    try {
      const payload: PendingSubmission = {
        id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        roomId: submitRoomId.toUpperCase().trim(),
        type: submitType,
        content: submitContent.trim(),
        submittedBy: submitSender.trim() || `發言終端_${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
        status: "pending",
        timestamp: Date.now(),
        additionalInfo: {
          assignee: todoAssignee.trim() || undefined,
          category: todoCategory.trim() || undefined,
          parentId: mindmapParentId.trim() || undefined,
          nodeType: mindmapNodeType || undefined
        }
      };

      if (broadcastMessageRef.current) {
        broadcastMessageRef.current({ type: "submit-proposal", submission: payload });
        setClientSubmitSuccessMsg("🎉 提案發起成功！主辦審核中心已獲取您的建議。待通過審核後會立即同步合併！");
        setSubmitContent("");
        setTodoAssignee("");
      } else {
        alert("發起提案失敗：無法與會議主機建立連線！");
      }
    } catch (e) {
      alert("發起提案時網絡連線錯誤。");
    } finally {
      setClientSubmitting(false);
    }
  };

  const handleAuditReview = async (id: string, status: "approved" | "rejected") => {
    try {
      const sub = pendingAudits.find(a => a.id === id);
      if (!sub) return;

      if (status === "approved") {
        const room = await getRoom(sub.roomId);
        if (room) {
          let updatedFields: Partial<RoomSession> = {};
          
          if (sub.type === "text" || sub.type === "voice") {
            const segment: MeetingSegment = {
              id: `seg-audit-${Date.now()}`,
              timestamp: Date.now(),
              sender: sub.submittedBy,
              text: sub.content,
              isVoice: sub.type === "voice"
            };
            updatedFields.segments = [...(room.segments || []), segment];
          } else if (sub.type === "todo") {
            const newTodo = {
              id: `todo-audit-${Date.now()}`,
              text: sub.content,
              assignee: sub.additionalInfo?.assignee,
              category: sub.additionalInfo?.category || "智庫",
              done: false
            };
            updatedFields.todos = [...(room.todos || []), newTodo];
          } else if (sub.type === "mindmap") {
            const newNode = {
              id: `node-audit-${Date.now()}`,
              parentId: sub.additionalInfo?.parentId || "root",
              label: sub.content,
              type: sub.additionalInfo?.nodeType || "detail"
            };
            updatedFields.mindmap = [...(room.mindmap || []), newNode];
          }

          const updatedRoom = { ...room, ...updatedFields };
          await saveRoom(updatedRoom);
          
          if (selectedHistoryMeeting && selectedHistoryMeeting.roomId === sub.roomId) {
            setSelectedHistoryMeeting(updatedRoom);
          }
          if (session && session.roomId === sub.roomId) {
            setSession(updatedRoom);
            if (broadcastMessageRef.current) {
              broadcastMessageRef.current({ type: "sync", session: updatedRoom });
            }
          }
        }
      }

      await deleteSubmission(id);
      addLog(`提案 ${id} 已進行審定: [${status === "approved" ? "核准通過" : "駁回不存"}]`);
      await fetchPendingAudits();
      await fetchMeetingsList();
    } catch (err) {
      console.error("Audit processing failed", err);
    }
  };




  const scheduledAnalysisRef = useRef(null);
  
  const lazyRefreshRoom = useCallback((targetRoomId, currentSegments) => {
    if (scheduledAnalysisRef.current) {
      clearTimeout(scheduledAnalysisRef.current);
    }
    
    scheduledAnalysisRef.current = setTimeout(async () => {
      if (aiMode === "cloud" && !geminiApiKey) {
        addLog("警告：未配置 GEMINI_API_KEY，跳過自動 AI 重點摘要更新。");
        return;
      }
      
      try {
        addLog("啟動背景 AI 會議內容結構化分析（摘要、待辦、心智圖）...");
        const room = await getRoom(targetRoomId);
        if (room && currentSegments.length > 0) {
          const analysisResult = await analyzeMeetingClientSide(
            geminiApiKey,
            currentSegments,
            selectedModel,
            aiMode
          );
          
          const updatedRoom = {
            ...room,
            summary: analysisResult.summary,
            todos: analysisResult.todos.map((t, idx) => ({
              id: `todo-${Date.now()}-${idx}`,
              text: t.text,
              assignee: t.assignee,
              category: t.category,
              done: false
            })),
            mindmap: analysisResult.mindmap
          };
          
          await saveRoom(updatedRoom);
          setSession(updatedRoom);
          addLog("自動 AI 會議內容結構化分析更新成功！");
          
          if (broadcastMessageRef.current) {
            broadcastMessageRef.current({ type: "sync", session: updatedRoom });
          }
        }
      } catch (err) {
        console.error("Auto analysis failed", err);
        addLog(`自動分析出錯: ${err.message}`);
      }
    }, 4000);
  }, [geminiApiKey, selectedModel, aiMode, addLog]);

  const handleP2PMessage = useCallback(async (fromId, message) => {
    if (message.type === "submit-proposal" && role === "host") {
      const submission = message.submission;
      addLog(`💡 收到終端 [${submission.submittedBy}] 發起的發言或待辦建議！`);
      await saveSubmission(submission);
      await fetchPendingAudits();
      return;
    }

    if (message.type === "voice-chunk" && role === "host") {
      const { audioData, mimeType } = message;
      addLog(`[語音流錄音] 正在為發言端轉錄語音...`);
      
      if (aiMode === "cloud" && !geminiApiKey) {
        addLog("警告：主機未配置 GEMINI_API_KEY，無法轉錄語音！");
        if (sendMessageRef.current) {
          sendMessageRef.current(fromId, { type: "error", message: "主機未配置 GEMINI_API_KEY，無法轉錄語音" });
        }
        return;
      }
      
      try {
        const text = await transcribeAudioClientSide(geminiApiKey, audioData, mimeType, selectedModel, aiMode);
        if (text && text.trim().length > 0) {
          addLog(`[轉錄完成] ${text}`);
          
          const segment = {
            id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            timestamp: Date.now(),
            sender: `發言端 (${fromId.slice(0, 5)})`,
            text,
            isVoice: true
          };

          const room = await getRoom(roomId);
          if (room) {
            const updatedSegments = [...(room.segments || []), segment];
            const updatedRoom = { ...room, segments: updatedSegments };
            await saveRoom(updatedRoom);
            setSession(updatedRoom);
            
            if (broadcastMessageRef.current) {
              broadcastMessageRef.current({ type: "new-segment", segment });
            }
            
            lazyRefreshRoom(roomId, updatedSegments);
          }
        }
      } catch (err) {
        console.error("Transcribing voice chunk failed", err);
        addLog(`語音轉錄失敗: ${err.message}`);
        if (sendMessageRef.current) {
          sendMessageRef.current(fromId, { type: "error", message: `語音轉錄失敗: ${err.message}` });
        }
      }
      return;
    }

    if (message.type === "text-chunk" && role === "host") {
      const { text } = message;
      if (text && text.trim()) {
        const segment = {
          id: `seg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
          sender: `發言端 (${fromId.slice(0, 5)})`,
          text: text.trim(),
          isVoice: false
        };

        const room = await getRoom(roomId);
        if (room) {
          const updatedSegments = [...(room.segments || []), segment];
          const updatedRoom = { ...room, segments: updatedSegments };
          await saveRoom(updatedRoom);
          setSession(updatedRoom);
          
          if (broadcastMessageRef.current) {
            broadcastMessageRef.current({ type: "new-segment", segment });
          }
          
          lazyRefreshRoom(roomId, updatedSegments);
        }
      }
      return;
    }

    if (message.type === "sync" && (role === "client" || role === "cohost")) {
      setSession(message.session);
      addLog("會議記錄完成增量同步。");
      return;
    }

    if (message.type === "new-segment" && (role === "client" || role === "cohost")) {
      setSession(prev => {
        if (!prev) return null;
        if (prev.segments.some(e => e.id === message.segment.id)) return prev;
        return {
          ...prev,
          segments: [...prev.segments, message.segment]
        };
      });
      addLog(`同步新訊息: ${message.segment.sender}: ${message.segment.text}`);
      return;
    }

    if (message.type === "error") {
      addLog(`[錯誤] ${message.message}`);
      alert(`來自會議主機的提示: ${message.message}`);
    }
  }, [role, roomId, geminiApiKey, selectedModel, aiMode, lazyRefreshRoom, addLog]);

  const handlePeerConnected = useCallback((peerClientId) => {
    addLog(`WebRTC 通道已與客戶端 ${peerClientId.slice(0, 5)} 成功連接！`);
    if (role === "host" && session) {
      if (sendMessageRef.current) {
        sendMessageRef.current(peerClientId, { type: "sync", session });
      }
    }
  }, [role, session, addLog]);

  const handleAuthFailed = useCallback((reason) => {
    if (reason === "PASSWORD_INVALID") {
      setPasswordGateRoomId(roomId);
      setPasswordGateRole(role);
      setPasswordGateOpen(true);
      setPasswordGateError("安全密碼核對失敗，請重新輸入！");
      setRole("none");
      setRoomId("");
    }
  }, [roomId, role]);

  // Setup P2P Link hook
  const { 
    status, 
    webrtcConnected, 
    joinedDevices, 
    broadcastMessage, 
    sendMessage, 
    disconnectAll: disconnectP2PLink 
  } = useP2PLink(
    roomId,
    role,
    clientId,
    clientName,
    roomStoredPassword,
    handleP2PMessage,
    handlePeerConnected,
    undefined,
    handleAuthFailed,
    addLog
  );

  const sendMessageRef = useRef(null);
  const broadcastMessageRef = useRef(null);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
    broadcastMessageRef.current = broadcastMessage;
  }, [sendMessage, broadcastMessage]);

  const sendContentParcel = (text: string) => {
    const payload = {
      type: "text-chunk",
      roomId,
      text: text.trim(),
      sender: clientName
    };

    if (broadcastMessageRef.current) {
      broadcastMessageRef.current(payload);
      addLog("已發送文字筆記。");
    } else {
      addLog("錯誤：網路不通，無法傳送資料。");
    }
  };

  // Handle start recording with custom hook callback
  const handleStartRecording = async () => {
    try {
      addLog("錄音裝置初始化完畢，準備發言中...");
      const actualMimeType = await startAudioRecording(async (audioBlob) => {
        addLog("發言中止，打包語音二進制流...");
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(",")[1];
          const audioPayload = {
            type: "voice-chunk",
            roomId,
            audioData: base64Data,
            mimeType: actualMimeType
          };

          if (broadcastMessageRef.current) {
            broadcastMessageRef.current(audioPayload);
            addLog("語音已成功發送。");
          } else {
            addLog("無法發送。未建立 P2P 直連通道。");
          }
        };
      });
    } catch (err: any) {
      addLog(`麥克風啟用故障，請核實設備權限: ${err.message}`);
    }
  };

  // Manual trigger Gemini analyzer
  const forceAnalyze = async () => {
    if (!roomId) return;
    
    if (aiMode === "cloud" && !geminiApiKey) {
      addLog("警告：未配置 GEMINI_API_KEY，無法執行 AI 重點摘要與分析！");
      alert("請先在設定中配置 GEMINI_API_KEY。");
      return;
    }

    addLog("啟動即時 AI 會議重點摘要與心智圖分析...");
    try {
      const room = await getRoom(roomId);
      if (room && room.segments && room.segments.length > 0) {
        const analysisResult = await analyzeMeetingClientSide(
          geminiApiKey,
          room.segments,
          selectedModel,
          aiMode
        );
        
        const updatedRoom: RoomSession = {
          ...room,
          summary: analysisResult.summary,
          todos: analysisResult.todos.map((t, idx) => ({
            id: `todo-${Date.now()}-${idx}`,
            text: t.text,
            assignee: t.assignee,
            category: t.category,
            done: false
          })),
          mindmap: analysisResult.mindmap
        };
        
        await saveRoom(updatedRoom);
        setSession(updatedRoom);
        addLog("重點總結與責任清單成功重新整理！");
        
        if (broadcastMessageRef.current) {
          broadcastMessageRef.current({ type: "sync", session: updatedRoom });
        }
      } else {
        addLog("會議目前無發言記錄，跳過分析。");
      }
    } catch (err: any) {
      addLog(`摘要刷新失敗: ${err.message}`);
    }
  };

  // Clear session data in IndexedDB
  const clearSessionOnServer = async () => {
    if (!roomId) return;
    if (!window.confirm("確定要重設目前会议的記錄、代辦清單與心智圖嗎？此操作不可逆。")) return;
    
    try {
      const room = await getRoom(roomId);
      if (room) {
        const updatedRoom: RoomSession = {
          ...room,
          segments: [],
          summary: "",
          todos: [],
          mindmap: []
        };
        await saveRoom(updatedRoom);
        setSession(updatedRoom);
        addLog("會議室已被成功重設為空白。");
        
        if (broadcastMessageRef.current) {
          broadcastMessageRef.current({ type: "sync", session: updatedRoom });
        }
      }
    } catch (err: any) {
      addLog(`重啟失敗: ${err.message}`);
    }
  };



  // Copy pairing connect code helper
  const copyConnectLink = () => {
    const origin = window.location.origin;
    const fullConnectLink = `${origin}?roomId=${roomId}&role=client`;
    navigator.clipboard.writeText(fullConnectLink);
    setIsCopying(true);
    addLog(`連線網址已複製至剪貼簿！`);
    setTimeout(() => setIsCopying(false), 2000);
  };

  const attemptJoinRoom = async (targetRole: Role, targetRoomId: string, enteredPassword?: string) => {
    try {
      const cleanRoomId = targetRoomId.toUpperCase().trim();
      addLog(`正在連線加入會議室... #${cleanRoomId}`);
      
      setRoomStoredPassword(enteredPassword || "");
      setRoomId(cleanRoomId);
      setRole(targetRole);
      setPasswordGateOpen(false);
      setPasswordGateError("");
      addLog(`成功向 P2P 會話通道註冊為 [${targetRole === "cohost" ? "協作控制端" : "發言終端"}]...`);
    } catch (err: any) {
      console.error(err);
      addLog(`加入會議出錯: ${err.message}`);
    }
  };

  const handleCreateHostRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreatingMeeting(true);
      const cleanRoomId = (setupRoomId.trim() || Math.random().toString(36).substring(2, 10)).toUpperCase().trim(); // 8 characters!
      const sendPassword = setupUsePassword ? setupPassword.trim() : "";
      
      const newRoom: RoomSession = {
        roomId: cleanRoomId,
        title: setupTitle.trim() || `會議 ${cleanRoomId}`,
        meetingDate: setupDate || new Date().toISOString().split("T")[0],
        password: sendPassword || undefined,
        createdTime: Date.now(),
        status: "active",
        segments: [],
        summary: "",
        todos: [],
        mindmap: [],
        recordings: []
      };

      await saveRoom(newRoom);
      addLog(`創建新會議 [${newRoom.title}] 成功，指定房號 [${newRoom.roomId}]`);
      
      setRoomStoredPassword(sendPassword);
      setRoomId(newRoom.roomId);
      setRole("host");
      setShowHostSetupForm(false);
      setSession(newRoom);
      
      await fetchMeetingsList();
    } catch (err: any) {
      console.error(err);
      addLog(`會議創建失敗: ${err.message}`);
    } finally {
      setCreatingMeeting(false);
    }
  };

  const handleRoleSelection = (selected: Role) => {
    if (selected === "host") {
      setShowHostSetupForm(true);
      setSetupTitle("聯網智能決策高層峰會");
      setSetupRoomId(Math.random().toString(36).substring(2, 7).toUpperCase());
      setSetupDate(new Date().toISOString().split("T")[0]);
      setSetupPassword("");
      setSetupUsePassword(false);
    } else {
      setRole(selected);
    }
  };

  const handleManualClientConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    const cleanRoomId = roomId.trim().toUpperCase();
    attemptJoinRoom(clientRoleChoice, cleanRoomId);
  };

  const handleDisconnect = () => {
    disconnectP2PLink();
    
    setRole("none");
    setSession(null);
    setRoomId("");
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-200 font-sans flex flex-col selection:bg-indigo-500/30 selection:text-white">
      
      {/* Visual background gradient accents */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-900/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-900/5 rounded-full blur-[120px] pointer-events-none" />

      {/* HEADER BAR */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-[#0B0E14]/85 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white">M</div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white flex items-center gap-2">
              OmniNotes <span className="text-indigo-400 font-normal">AI</span>
              {role !== "none" && (
                <span className={`text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded ${
                  role === "host" ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                }`}>
                  {role === "host" ? "記錄主機端" : "發言終端"}
                </span>
              )}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {role !== "none" && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${status === "online" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></div>
                <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {status === "online" ? "Host Backend Active" : "Host Backend Offline"}
                  {webrtcConnected && " / P2P active"}
                </span>
              </div>
              <div className="h-8 w-px bg-slate-800"></div>
              <button 
                onClick={handleDisconnect}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-full text-sm font-medium transition-colors border border-slate-700 text-slate-200"
              >
                Leave Room
              </button>
            </div>
          )}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-slate-100 border border-slate-700 transition duration-150 cursor-pointer flex items-center justify-center"
            title="設定 AI 密鑰與模型"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* CORE DISPLAY ROUTER */}
      <main className="flex-1 p-6 relative z-10 flex flex-col justify-center">
        
        {/* ==================== 1. ROLE DECK CHOICE SCREEN ==================== */}
        {role === 'none' && (
          <HomeView
            roomId={roomId}
            setRoomId={setRoomId}
            clientRoleChoice={clientRoleChoice}
            setClientRoleChoice={setClientRoleChoice}
            showHostSetupForm={showHostSetupForm}
            setShowHostSetupForm={setShowHostSetupForm}
            setupTitle={setupTitle}
            setSetupTitle={setSetupTitle}
            setupDate={setupDate}
            setSetupDate={setSetupDate}
            setupRoomId={setupRoomId}
            setSetupRoomId={setSetupRoomId}
            setupUsePassword={setupUsePassword}
            setSetupUsePassword={setSetupUsePassword}
            setupPassword={setupPassword}
            setSetupPassword={setSetupPassword}
            creatingMeeting={creatingMeeting}
            handleCreateHostRoom={handleCreateHostRoom}
            handleManualClientConnect={handleManualClientConnect}
            handleRoleSelection={handleRoleSelection}
            apiHealth={apiHealth}
          />
        )}

        {/* ==================== 1.3 SETTINGS CONFIG DIALOG ==================== */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          geminiApiKey={geminiApiKey}
          setGeminiApiKey={setGeminiApiKey}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          aiMode={aiMode}
          setAiMode={setAiMode}
        />

        {/* ==================== 1.2 SAFETY PASSWORD GATE DIALOG ==================== */}
        <PasswordGate
          isOpen={passwordGateOpen}
          error={passwordGateError}
          passwordInput={passwordGateInput}
          setPasswordInput={setPasswordGateInput}
          onSubmit={(e) => {
            e.preventDefault();
            attemptJoinRoom(passwordGateRole, passwordGateRoomId, passwordGateInput);
          }}
          onCancel={() => {
            setPasswordGateOpen(false);
            setPasswordGateError("");
            setRole("none");
          }}
        />

        {/* ==================== 2. HOST / BACKEND MEETING SCREEN ==================== */}
        {role === "host" && (
          <HostDashboard
            roomId={roomId}
            session={session}
            joinedDevices={joinedDevices}
            diagnosticsLog={diagnosticsLog}
            roomStoredPassword={roomStoredPassword}
            hostTab={hostTab}
            setHostTab={setHostTab}
            pendingAudits={pendingAudits}
            isLoadingMeetings={isLoadingMeetings}
            meetingsList={meetingsList}
            selectedHistoryMeeting={selectedHistoryMeeting}
            setSelectedHistoryMeeting={setSelectedHistoryMeeting}
            isLoadingAudits={isLoadingAudits}
            geminiApiKey={geminiApiKey}
            selectedModel={selectedModel}
            isCoping={isCoping}
            copyConnectLink={copyConnectLink}
            fetchMeetingsList={fetchMeetingsList}
            fetchPendingAudits={fetchPendingAudits}
            createNewHistoricalMeeting={createNewHistoricalMeeting}
            forceAnalyze={forceAnalyze}
            clearSessionOnServer={clearSessionOnServer}
            handleAudioFileUpload={handleAudioFileUpload}
            saveMeetingModification={saveMeetingModification}
            loadHistoryMeetingDetail={loadHistoryMeetingDetail}
            handleTranscriptFileUpload={handleTranscriptFileUpload}
            handleAuditReview={handleAuditReview}
            addLog={addLog}
          />
        )}

        {/* ==================== 3. CLIENT / TRANSMITTER VOICE PANEL ==================== */}
        {role === 'client' && (
          <ClientTerminal
            roomId={roomId}
            clientName={clientName}
            session={session}
            meetingsList={meetingsList}
            fetchMeetingsList={fetchMeetingsList}
            startRecording={handleStartRecording}
            stopRecording={stopAudioRecording}
            sendContentParcel={sendContentParcel}
            broadcastMessage={broadcastMessage}
          />
        )}

      </main>

      {/* FOOTER METADATA DESIGNS */}
      <footer className="border-t border-slate-900 bg-slate-950/40 py-5 px-6 flex justify-between items-center flex-shrink-0 text-xs text-slate-500 font-mono tracking-tight">
        <div>
          <span>開會記錄中樞系統</span>
        </div>
        <div className="flex items-center gap-6">
          <span>Views: <span id="vercount_value_site_pv">--</span></span>
          <span>Visitors: <span id="vercount_value_site_uv">--</span></span>
          <span className="text-slate-700">|</span>
          <span>REAL-TIME ANALYSIS HOSTED BY GEMINI</span>
        </div>
      </footer>

    </div>
  );
}
