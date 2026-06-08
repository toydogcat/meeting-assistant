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
import { QRCodeSVG } from "qrcode.react";
import { Role, RoomSession, MeetingSegment, TodoItem, MindmapNode, PendingSubmission, MeetingRecording } from "./types";
import { motion, AnimatePresence } from "motion/react";
import { useP2PLink } from "./hooks/useP2PLink";
import { 
  getRooms, getRoom, saveRoom, deleteRoom, 
  getSubmissions, saveSubmission, deleteSubmission, 
  seedDatabaseIfEmpty 
} from "./utils/db";
import { transcribeAudioClientSide, analyzeMeetingClientSide, GEMINI_MODELS } from "./utils/gemini";

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

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(0);

  // Settings config states (Host client-side Gemini config)
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem("meeting_assistant_gemini_api_key") || "");
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("meeting_assistant_selected_model") || "gemini-2.5-flash");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // References for WebAudio and DOM
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Log diagnostic events
  const addLog = useCallback((msg: string) => {
    console.log(`[Diagnostic] ${msg}`);
    const time = new Date().toLocaleTimeString();
    setDiagnosticsLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 40));
  }, []);

  // Update Gemini configuration health
  useEffect(() => {
    setApiHealth({ alive: true, keyConfigured: !!geminiApiKey });
  }, [geminiApiKey]);

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

  // Client meetings list filters
  const [clientBrowseSearch, setClientBrowseSearch] = useState("");
  const [clientSelectedViewMeeting, setClientSelectedViewMeeting] = useState<RoomSession | null>(null);

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
  const [isolatedNodeCodeTab, setIsolatedNodeCodeTab] = useState<"node" | "python">("node");

  // Loaders
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [isLoadingAudits, setIsLoadingAudits] = useState(false);

  // Host inline variables editor
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editDateVal, setEditDateVal] = useState("");
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editSummaryVal, setEditSummaryVal] = useState("");



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
        setEditTitleVal(room.title || room.roomId);
        setEditDateVal(room.meetingDate || "");
        setEditSummaryVal(room.summary || "");
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


  // Autoscroll the live transcription timeline
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.segments]);

  const scheduledAnalysisRef = useRef(null);
  
  const lazyRefreshRoom = useCallback((targetRoomId, currentSegments) => {
    if (scheduledAnalysisRef.current) {
      clearTimeout(scheduledAnalysisRef.current);
    }
    
    scheduledAnalysisRef.current = setTimeout(async () => {
      if (!geminiApiKey) {
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
            selectedModel
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
  }, [geminiApiKey, selectedModel, addLog]);

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
      
      if (!geminiApiKey) {
        addLog("警告：主機未配置 GEMINI_API_KEY，無法轉錄語音！");
        if (sendMessageRef.current) {
          sendMessageRef.current(fromId, { type: "error", message: "主機未配置 GEMINI_API_KEY，無法轉錄語音" });
        }
        return;
      }
      
      try {
        const text = await transcribeAudioClientSide(geminiApiKey, audioData, mimeType, selectedModel);
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
  }, [role, roomId, geminiApiKey, selectedModel, lazyRefreshRoom, addLog]);

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

  // Microphone audio capture hook (using MediaRecorder)
  const startRecording = async () => {
    if (isRecording) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsRecording(true);
      addLog("錄音裝置初始化完畢，準備發言中...");

      // Choose optimal audio encoding
      let options = {};
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options = { mimeType: "audio/webm;codecs=opus" };
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options = { mimeType: "audio/webm" };
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        options = { mimeType: "audio/ogg" };
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      // Audio frequency wave visualizer setup
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;

      audioContextRef.current = audioCtx;
      audioAnalyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        setVoiceVolume(average); // 0-255 scale
        rafRef.current = requestAnimationFrame(updateVolume);
      };
      
      updateVolume();

      // Accumulator array
      let chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setVoiceVolume(0);
        addLog("發言中止，打包語音二進制流...");

        const audioBlob = new Blob(chunks, { type: mediaRecorder.mimeType });
        chunks = [];

        // Stop all audio feed tracks
        stream.getTracks().forEach(track => track.stop());

        // File Reader Base64 encoder
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(",")[1];
          const audioPayload = {
            type: "voice-chunk",
            roomId,
            audioData: base64Data,
            mimeType: mediaRecorder.mimeType
          };

          if (broadcastMessageRef.current) {
            broadcastMessageRef.current(audioPayload);
            addLog("語音已成功發送。");
          } else {
            addLog("無法發送。未建立 P2P 直連通道。");
          }
        };

        if (audioCtx.state !== "closed") {
          audioCtx.close();
        }
      };

      // Start recording triggers slice periods
      mediaRecorder.start();

    } catch (err: any) {
      addLog(`麥克風啟用故障，請核實設備權限: ${err.message}`);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    }
  };

  // Manual trigger Gemini analyzer
  const forceAnalyze = async () => {
    if (!roomId) return;
    setIsRecording(false);
    
    if (!geminiApiKey) {
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
          selectedModel
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

  // Dynamically compute layout coordinates for any mindmap elements array
  const getLayedNodesForMap = useCallback((mindmap?: MindmapNode[]) => {
    if (!mindmap || mindmap.length === 0) return [];
    
    const root = mindmap.find(n => n.id === "root" || !n.parentId) || mindmap[0];
    const children = mindmap.filter(n => n.parentId === root.id);

    const centerX = 340;
    const centerY = 150;
    
    const res: { id: string; label: string; x: number; y: number; type: string; parentId?: string }[] = [];
    res.push({ id: root.id, label: root.label, x: centerX, y: centerY, type: root.type || "topic" });

    children.forEach((child, index) => {
      const isLeft = index % 2 === 0;
      const verticalIndex = Math.floor(index / 2);
      
      const offsetX = isLeft ? -145 : 145;
      const offsetY = (verticalIndex - (Math.floor(children.length / 2) * 0.5)) * 80;

      const cX = centerX + offsetX;
      const cY = centerY + offsetY;

      res.push({ id: child.id, label: child.label, x: cX, y: cY, type: child.type || "topic", parentId: root.id });

      const grans = mindmap.filter(n => n.parentId === child.id);
      grans.forEach((gr, grIdx) => {
        const gcOffsetX = isLeft ? -110 : 110;
        const gcOffsetY = (grIdx - ((grans.length - 1) / 2)) * 36;

        res.push({
          id: gr.id,
          label: gr.label,
          x: cX + gcOffsetX,
          y: cY + gcOffsetY,
          type: gr.type || "detail",
          parentId: child.id
        });
      });
    });

    return res;
  }, []);

  const layedNodes = useMemo(() => {
    return getLayedNodesForMap(session?.mindmap);
  }, [session?.mindmap, getLayedNodesForMap]);

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
      setStatus("connecting");
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
      setStatus("offline");
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
    if (wsRef.current) wsRef.current.close();
    if (pcRef.current) pcRef.current.close();
    clientPcsRef.current.forEach(pc => pc.close());
    clientPcsRef.current.clear();
    clientDataChannelsRef.current.clear();
    
    setRole("none");
    setSession(null);
    setRoomId("");
    setJoinedDevices([]);
    setWebrtcConnected(false);
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
        {role === "none" && (
          <div className="max-w-4xl mx-auto w-full py-10 px-4">
            
            {/* 1.1 CONFIGURABLE HOST SETUP FORM */}
            {showHostSetupForm ? (
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600" />
                
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                      <Cpu className="text-indigo-400 w-6 h-6" />
                      主機開房參數配置
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">請自定義智能主機的運行與安全設定</p>
                  </div>
                  <button 
                    onClick={() => setShowHostSetupForm(false)}
                    className="text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium transition"
                  >
                    返回選擇
                  </button>
                </div>

                <form onSubmit={handleCreateHostRoom} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">會議主體標題 (Meeting Title)</label>
                      <input 
                        type="text" 
                        required
                        value={setupTitle}
                        onChange={(e) => setSetupTitle(e.target.value)}
                        placeholder="例如：系統架構技術迭代週會"
                        className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">會議開展日期 (Meeting Date)</label>
                      <input 
                        type="date" 
                        required
                        value={setupDate}
                        onChange={(e) => setSetupDate(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6 pt-2">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">自訂5字元房號 (Room ID)</label>
                        <span className="text-[10px] text-slate-500">不填則隨機分配</span>
                      </div>
                      <input 
                        type="text" 
                        maxLength={5}
                        placeholder="選填，如: TECH8"
                        value={setupRoomId}
                        onChange={(e) => setSetupRoomId(e.target.value.toUpperCase())}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal uppercase"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">啟用房間密碼安全保護</label>
                        <input 
                          type="checkbox" 
                          checked={setupUsePassword}
                          onChange={(e) => setSetupUsePassword(e.target.checked)}
                          className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-slate-800 rounded bg-slate-950"
                        />
                      </div>
                      <input 
                        type="password" 
                        disabled={!setupUsePassword}
                        required={setupUsePassword}
                        placeholder={setupUsePassword ? "請設定 4~8 碼安全密碼..." : "未啟用密碼保護，任何人皆可直連"}
                        value={setupPassword}
                        onChange={(e) => setSetupPassword(e.target.value)}
                        className={`w-full bg-slate-950 border text-white rounded-xl px-4 py-3 text-sm outline-none transition-all ${
                          setupUsePassword ? "border-indigo-500/50 focus:border-indigo-500" : "border-slate-800/40 opacity-40 select-none"
                        }`}
                      />
                    </div>
                  </div>

                  <div className="bg-slate-950/60 p-4 border border-slate-800/60 rounded-2xl text-[11px] text-slate-400 space-y-1">
                    <p className="font-semibold text-slate-300">💡 混合部署架構部署說明：</p>
                    <p>1. 本主機部署成功後，會自動在當前容器 (Port 3000) 初始化 WebSocket 信令、語音流編解碼、以及 WebRTC 雙向配對。</p>
                    <p>2. 您亦可在後續『前後端分離聯網資訊』專區獲取原始碼，部署於您本機、Macbook/手提電腦，實現完全隔絕部署！</p>
                  </div>

                  <div className="flex gap-4 pt-2">
                    <button
                      type="submit"
                      disabled={creatingMeeting}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-semibold py-3.5 rounded-xl transition shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 text-sm cursor-pointer"
                    >
                      {creatingMeeting ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          正在配對初始化信令...
                        </>
                      ) : (
                        "配置完成，開起智能記錄主機 🚀"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHostSetupForm(false)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-6 rounded-xl transition text-sm font-medium"
                    >
                      取消
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <>
                <div className="text-center mb-12 animate-in fade-in slide-in-from-top-6 duration-300">
                  <span className="text-xs font-bold text-indigo-400 tracking-widest uppercase bg-indigo-500/15 border border-indigo-500/30 px-3 py-1 rounded-full">
                    AI Powered Meeting Engine
                  </span>
                  <h2 className="text-3xl font-bold text-white tracking-tight mt-4">請選擇開會程序角色開始</h2>
                  <p className="text-gray-400 max-w-xl mx-auto mt-2 text-sm leading-relaxed">
                    本系統為專屬多模態語音/文字處理架構。主機端與發言終端可透過 P2P 直流或是 WebSocket 即時連線，
                    自動調用 Gemini 3.5 智慧模型編譯完整的對話大綱、待辦清單並生成關聯圖。
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 items-stretch">
                  {/* Host Portal Options card */}
                  <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between transition duration-300 hover:border-slate-700 hover:shadow-2xl hover:shadow-indigo-500/5 group">
                    <div>
                      <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 group-hover:bg-indigo-500/20 rounded-2xl w-fit mb-6 transition">
                        <Cpu className="w-8 h-8 text-indigo-400" />
                      </div>
                      <h3 className="text-xl font-semibold tracking-tight text-white group-hover:text-indigo-300 transition flex items-center gap-2">
                        會議記錄主機 (Host Box) 
                        <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded uppercase font-medium">主要</span>
                      </h3>
                      <p className="text-slate-400 text-sm mt-3 leading-relaxed">
                        負責架設與主持會議。這台設備會產生專屬的 **連線房號 與 QR Code**，開啟中樞大螢幕。
                        它能接收並顯示所有發言手機/終端的語音或文字，同步顯示實時分析。
                      </p>
                      
                      <ul className="text-xs text-slate-500 mt-5 space-y-2">
                        <li className="flex items-center gap-2">✔ 大會投影/整合控制螢幕</li>
                        <li className="flex items-center gap-2">✔ 即時生成 SVG 思維心智圖</li>
                        <li className="flex items-center gap-2">✔ 會議重點與工作待辦提取儀表板</li>
                      </ul>
                    </div>
                    
                    <button
                      onClick={() => handleRoleSelection("host")}
                      className="mt-8 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-full transition shadow-lg shadow-indigo-600/25 cursor-pointer text-center block animate-pulse hover:animate-none"
                    >
                      架設新記錄主機 ➜
                    </button>
                  </div>

                  {/* Client Portal Options card */}
                  <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between transition duration-300 hover:border-slate-700 hover:shadow-2xl hover:shadow-emerald-500/5 group">
                    <div>
                      <div className="p-4 bg-emerald-500/15 border border-emerald-500/20 group-hover:bg-emerald-500/25 rounded-2xl w-fit mb-6 transition">
                        <Mic className="w-8 h-8 text-emerald-400" />
                      </div>
                      <h3 className="text-xl font-semibold tracking-tight text-white group-hover:text-emerald-300 transition flex items-center gap-2">
                        發言連線終端 (Mobile Panel)
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded uppercase font-medium">連線終端</span>
                      </h3>
                      
                      {/* Sub-role selector client view selector */}
                      <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex gap-1 mt-4">
                        <button
                          type="button"
                          onClick={() => setClientRoleChoice("client")}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            clientRoleChoice === "client" 
                              ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 shadow-indigo-500/10" 
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          🎤 麥克風/語意發言端
                        </button>
                        <button
                          type="button"
                          onClick={() => setClientRoleChoice("cohost")}
                          className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                            clientRoleChoice === "cohost" 
                              ? "bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 shadow-indigo-500/10" 
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          📱 手機協同控制端
                        </button>
                      </div>

                      <p className="text-slate-400 text-sm mt-4 leading-relaxed">
                        {clientRoleChoice === "client" ? (
                          "加入既有的會議中。無論是透過手機鏡頭掃瞄主機端二維碼聯通，或是手邊輸入房間號碼，即可錄音打字投入主畫面。"
                        ) : (
                          "專為行政或第二控制人員設計的手持面板。免除大螢幕阻擋，用手機即可在台下一鍵觸發 AI 智庫決策、審核登載或標記任務！"
                        )}
                      </p>
                      
                      <ul className="text-xs text-slate-500 mt-4 space-y-2">
                        {clientRoleChoice === "client" ? (
                          <>
                            <li className="flex items-center gap-2">✔ 滑動開/關麥克風實時錄音</li>
                            <li className="flex items-center gap-2">✔ 彈性輸入文字補充備註與決策點</li>
                          </>
                        ) : (
                          <>
                            <li className="flex items-center gap-2">✔ 無縫控制主機端的 Gemini AI 智庫精算</li>
                            <li className="flex items-center gap-2">✔ 即時檢索、核定或淘汰未經審批的發言</li>
                          </>
                        )}
                      </ul>
                    </div>
                    
                    <form onSubmit={handleManualClientConnect} className="mt-8 space-y-3">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="輸入5碼房號 (如TECH8)..." 
                          value={roomId}
                          onChange={(e) => setRoomId(e.target.value)}
                          className="bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 text-white rounded-full px-5 py-3 text-sm flex-1 outline-none font-mono tracking-wider placeholder:font-sans uppercase"
                        />
                        <button
                          type="submit"
                          className={`font-semibold px-6 rounded-full transition cursor-pointer text-white text-xs ${
                            clientRoleChoice === "cohost" ? "bg-indigo-600 hover:bg-indigo-500" : "bg-emerald-600 hover:bg-emerald-500"
                          }`}
                        >
                          {clientRoleChoice === "cohost" ? "協作登入" : "發言連線"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </>
            )}

            {/* Keys setup reminder */}
            {!apiHealth.keyConfigured && apiHealth.alive && (
              <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-xl max-w-2xl mx-auto flex gap-3 text-xs text-red-300">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Gemini 密鑰未配對</p>
                  <p className="opacity-80 font-sans">
                    系統尚未檢測到您的 API 秘密金鑰，這會導致 AI 重點摘要與分析功能無法作用。
                    請點按面板右上角 **Settings ➔ Secrets** 專區配置 <code>GEMINI_API_KEY</code> 秘密密鑰後，手動重新整理網頁。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 1.3 SETTINGS CONFIG DIALOG ==================== */}
        {isSettingsOpen && (
          <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
              
              <div className="flex gap-3 mb-4">
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl h-fit">
                  <Settings className="w-5 h-5 animate-spin-slow" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-white tracking-tight">Gemini AI 引擎配置</h4>
                  <p className="text-[10px] text-slate-400 mt-1">設定本地儲存的金鑰與模型</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Gemini API Key</label>
                  <input 
                    type="password"
                    placeholder="輸入您的 Gemini API Key..."
                    value={geminiApiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setGeminiApiKey(val);
                      localStorage.setItem("meeting_assistant_gemini_api_key", val);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">預設 Generative Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedModel(val);
                      localStorage.setItem("meeting_assistant_selected_model", val);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none cursor-pointer"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (預設推薦)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (高精確度度量)</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash (舊版速度)</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro (舊版大模型)</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-3 rounded-xl transition cursor-pointer text-center"
                  >
                    確認並儲存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 1.2 SAFETY PASSWORD GATE DIALOG ==================== */}
        {passwordGateOpen && (
          <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
              
              <div className="flex gap-3 mb-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl h-fit">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-md font-bold text-white tracking-tight">安全聯網通訊驗證</h4>
                  <p className="text-[10px] text-slate-400 mt-1">此會議已開啟房間安全防護</p>
                </div>
              </div>

              {passwordGateError && (
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400 rounded-xl font-medium">
                  ⚠️ {passwordGateError}
                </div>
              )}

              <form onSubmit={(e) => {
                e.preventDefault();
                attemptJoinRoom(passwordGateRole, passwordGateRoomId, passwordGateInput);
              }} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">請輸入會議房間密碼 (Room Password)</label>
                  <input 
                    type="password"
                    required
                    autoFocus
                    placeholder="輸入對接密碼..."
                    value={passwordGateInput}
                    onChange={(e) => setPasswordGateInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-emerald-500 text-white rounded-xl px-4 py-3 text-sm outline-none font-mono tracking-widest text-center"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-3 rounded-xl transition cursor-pointer"
                  >
                    驗證對接 ➜
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordGateOpen(false);
                      setPasswordGateError("");
                      setRole("none");
                      setStatus("offline");
                    }}
                    className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ==================== 2. HOST / BACKEND MEETING SCREEN ==================== */}
        {role === "host" && (
          <div className="grid lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full items-start">
            
            {/* Sidebar paired control deck */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              {/* Box 1: Host QR and Sync Pairing */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col items-center justify-center text-center">
                <div className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-4">Device Connection</div>
                
                <div className="w-36 h-36 bg-white p-2 rounded-2xl mb-4 flex items-center justify-center shadow-lg">
                  <QRCodeSVG 
                    value={`${window.location.origin}?roomId=${roomId}&role=client`} 
                    size={128}
                    bgColor={"#FFFFFF"}
                    fgColor={"#0B0E14"}
                    level={"H"}
                  />
                </div>
                
                <div className="text-2xl font-mono font-bold text-white tracking-widest uppercase">ROOM: {roomId}</div>
                <p className="text-xs text-slate-500 mt-2 italic">Scan QR or enter code on front speaker terminal</p>

                <div className="space-y-2 w-full mt-4">
                  <button
                    onClick={copyConnectLink}
                    className="w-full flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 py-2.5 rounded-full text-xs font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    {isCoping ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        連結已複製！
                      </>
                    ) : (
                      <>
                        <Copy className="w-1.5 h-1.5 text-slate-400" />
                        複製發言連線頁面
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Box 2: Roster connected participant clients */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4 border-l-2 border-indigo-500 pl-3">連線中之終端陣容 ({joinedDevices.length})</h4>
                {joinedDevices.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center border border-dashed border-slate-800 rounded-2xl">
                    尚未有連線發言終端
                  </p>
                ) : (
                  <div className="space-y-2">
                    {joinedDevices.map((device, i) => (
                      <div key={device.id} className="flex items-center justify-between text-xs p-3.5 bg-slate-850/40 rounded-2xl border border-slate-800/80">
                        <span className="font-mono text-slate-300 flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                          發言端-{device.id.slice(0, 5)}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-medium font-mono">直連運作中</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Box 3: Console activity feeds */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-3">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wider border-l-2 border-slate-500 pl-3 flex items-center gap-1.5 font-sans">
                  <SquareTerminal className="w-3.5 h-3.5 text-indigo-400" />
                  實時通訊日誌
                </h4>
                <div className="bg-slate-950/60 border border-slate-800/60 rounded-2xl p-4 h-44 overflow-y-auto font-mono text-[10px] text-indigo-300/80 space-y-1.5 scrollbar-thin">
                  {diagnosticsLog.map((logStr, idx) => (
                    <div key={idx} className="leading-normal break-all text-left">
                      {logStr}
                    </div>
                  ))}
                  {diagnosticsLog.length === 0 && (
                    <div className="text-slate-500 italic text-center py-5">
                      待命狀態，通訊準備就緒...
                    </div>
                  )}
                </div>
              </div>

              {/* Box 4: Decoupled Independent Host Server */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 space-y-4">
                <div>
                  <h4 className="text-xs font-semibold text-white uppercase tracking-wider border-l-2 border-emerald-500 pl-3 flex items-center justify-between font-sans">
                    <span>⚡ 獨立錄音紀錄主機部署</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono font-normal">前後端分離</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    您可在一台獨立電腦 (如手提筆電) 開啟錄音主機專屬後端，透過 API 進程聯網，實現超高音質、完全客製的安全會議。
                  </p>
                </div>

                {/* Sub-tab choice */}
                <div className="bg-slate-950 p-1 rounded-xl border border-slate-850 flex gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setIsolatedNodeCodeTab("node")}
                    className={`flex-1 py-1.5 font-semibold rounded-lg text-center transition ${
                      isolatedNodeCodeTab === "node" 
                        ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/20" 
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    🛠️ Node.js 後端 (推薦)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsolatedNodeCodeTab("python")}
                    className={`flex-1 py-1.5 font-semibold rounded-lg text-center transition ${
                      isolatedNodeCodeTab === "python" 
                        ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/20" 
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    🐍 Python 後端
                  </button>
                </div>

                {/* Node or Python connection guide */}
                <div className="bg-slate-950 p-3 rounded-2xl border border-slate-850 text-left space-y-2">
                  <span className="text-[9px] font-mono font-bold text-slate-500 block uppercase">
                    {isolatedNodeCodeTab === "node" ? "Deploy separate Node.js server" : "Deploy separate Python server"}
                  </span>
                  
                  {isolatedNodeCodeTab === "node" ? (
                    <div className="space-y-1.5 text-[10px]/relaxed text-slate-400">
                      <p className="text-slate-350 font-semibold font-sans">步驟 1: 建立後端依賴與伺服器檔</p>
                      <pre className="p-2 bg-slate-905 border border-slate-800 rounded text-[9px] text-indigo-300 font-mono overflow-x-auto whitespace-pre">
{`npm install express ws dotenv @google/genai`}
                      </pre>
                      <p className="text-slate-350 font-semibold font-sans">步驟 2: 連線設定環境變數 (.env)</p>
                      <pre className="p-2 bg-slate-905 border border-slate-800 rounded text-[9px] text-teal-400 font-mono overflow-x-auto">
{`API_URL=${window.location.origin}
ROOM_ID=${roomId}
PASSWORD=${roomStoredPassword || "無"}`}
                      </pre>
                      <p className="text-slate-350 font-semibold font-sans">步驟 3: 執行微服務</p>
                      <p className="text-[10px]/normal text-slate-400 italic">
                        Node 提供超高併發 WebSockets，低延遲編解碼處理，為多端語音紀錄及 AI 任務的最佳中樞架構。
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 text-[10px]/relaxed text-slate-400">
                      <p className="text-slate-350 font-semibold font-sans">步驟 1: 建立 Python 框架依賴</p>
                      <pre className="p-2 bg-slate-905 border border-slate-800 rounded text-[9px] text-indigo-300 font-mono overflow-x-auto">
{`pip install websockets requests pyaudio google-genai`}
                      </pre>
                      <p className="text-slate-350 font-semibold font-sans">步驟 2: 配置伺服器直連腳本 (.env)</p>
                      <pre className="p-2 bg-slate-905 border border-slate-800 rounded text-[9px] text-emerald-400 font-mono overflow-x-auto">
{`ROOM_ID: ${roomId}
CONN: ${window.location.origin.replace(/^http/, 'ws')}/api/ws`}
                      </pre>
                      <p className="text-slate-350 font-semibold font-sans">步驟 3: PyAudio 驅動特長</p>
                      <p className="text-[10px]/normal text-slate-400 italic">
                        Python 驅動對接時，能即時抓取端點硬體音頻流，提供對接大會硬件最佳方案！
                      </p>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl space-y-1 text-[10px] text-indigo-300">
                  <p className="font-semibold flex items-center gap-1">📱 協同控制端對接說明：</p>
                  <p>行政控制人員可用手機掃描上方二維碼，以 【協同控制端 (CoHost)】角色進入，即可即時在手機端核准或退回終端提報的建議事項，免除主機大螢幕滑鼠操作之苦！</p>
                </div>
              </div>

            </div>

            {/* Dashboard Content Blocks with Tabs Interface */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* Tab Navigation header */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/50 border border-slate-800 p-4 rounded-3xl">
                <div className="flex bg-slate-950 border border-slate-850 p-1 rounded-2xl w-full sm:w-auto">
                  <button
                    onClick={() => setHostTab("live")}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      hostTab === "live"
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                        : "text-slate-400 hover:text-slate-100"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    🟢 實時會議監控
                  </button>
                  <button
                    onClick={() => {
                      setHostTab("history");
                      fetchMeetingsList();
                    }}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      hostTab === "history"
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                        : "text-slate-400 hover:text-slate-100"
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    📅 歷史期會總覽
                  </button>
                  <button
                    onClick={() => {
                      setHostTab("audit");
                      fetchPendingAudits();
                    }}
                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-semibold tracking-wider transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      hostTab === "audit"
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/10"
                        : "text-slate-400 hover:text-slate-100"
                    }`}
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    ⚖️ 提案審核中心
                    {pendingAudits.filter(a => a.status === "pending").length > 0 && (
                      <span className="bg-rose-500 text-white font-mono text-[9px] px-1.5 py-0.5 rounded-full ml-1 animate-bounce">
                        {pendingAudits.filter(a => a.status === "pending").length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {hostTab === "history" && (
                    <button
                      onClick={() => {
                        const title = prompt("請輸入新增歷史會議的主題標題：", `決策會期_${new Date().toISOString().split("T")[0]}`);
                        if (title) createNewHistoricalMeeting(title);
                      }}
                      className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3.5 py-2 rounded-full transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
                    >
                      <Plus className="w-3.5 h-3.5" /> 創建新會期
                    </button>
                  )}
                  {hostTab === "live" && (
                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1.5 rounded-full flex items-center gap-1.5 font-mono font-bold">
                      <Wifi className="w-3 h-3 text-emerald-400 animate-pulse" /> 實時信號已連線
                    </span>
                  )}
                </div>
              </div>

              {/* ==================== SUB-VIEW A: ACTIVE LIVE MONITORING ==================== */}
              {hostTab === "live" && (
                <div className="flex flex-col gap-6">
                  {/* Primary dashboard action control buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-900/50 border border-slate-800 p-6 rounded-3xl">
                    <div>
                      <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                         會議室記錄主控系統已開通
                      </span>
                      <p className="text-xs text-slate-400 mt-1">終端只需對麥克風說話或是打字，中樞將主導即時匯聚與分析</p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={forceAnalyze}
                        disabled={session?.status === "analyzing" || !session?.segments.length}
                        className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-500/20 text-white font-semibold text-xs px-5 py-2.5 rounded-full transition shadow-lg shadow-indigo-600/20 cursor-pointer disabled:cursor-not-allowed border border-indigo-500/30"
                      >
                        <RefreshCw className={`w-3 h-3 ${session?.status === "analyzing" ? "animate-spin" : ""}`} />
                        刷新 AI 總結分析
                      </button>

                      <button
                        onClick={clearSessionOnServer}
                        className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 text-slate-400 hover:text-rose-300 text-xs px-4 py-2.5 rounded-full transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        清除會議
                      </button>
                    </div>
                  </div>

                  {/* Bento grid panels split */}
                  <div className="grid md:grid-cols-12 gap-6">
                    
                    {/* Panel A - Realtime Transcript scrollbar */}
                    <div className="md:col-span-4 bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col h-[540px]">
                      <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-4 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                          <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                          實時語音逐字稿 ({session?.segments.length || 0})
                        </h3>
                      </div>

                      {/* Scroll box */}
                      <div 
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scroll-smooth"
                      >
                        {session?.segments.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                            <Mic className="w-10 h-10 stroke-1 text-slate-600 mb-3 animate-bounce" />
                            <p className="text-sm font-semibold text-slate-400">靜音待命狀態</p>
                            <p className="text-xs max-w-[180px] mt-1 leading-normal text-slate-500">
                              終端用戶可造訪對等連線，發言將即時顯現於此。
                            </p>
                          </div>
                        ) : (
                          session?.segments.map((seg) => (
                            <div key={seg.id} className="p-3.5 bg-slate-850/40 border border-slate-800/80 rounded-2xl space-y-1.5 hover:border-slate-700 transition-all">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 font-mono">
                                  {seg.sender}
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {new Date(seg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-xs text-slate-200 leading-relaxed break-words font-medium">
                                {seg.text}
                              </p>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Host Direct Audio Attachment inside active desk */}
                      <div className="mt-4 pt-3 border-t border-slate-800 flex-shrink-0 space-y-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">附加音訊至此實時會議</span>
                        <div className="flex gap-2">
                          <input 
                            type="file" 
                            id="live-audio-file" 
                            className="hidden" 
                            accept="audio/*" 
                            onChange={(e) => {
                              if (session) handleAudioFileUpload(e, session.roomId);
                            }} 
                          />
                          <label 
                            htmlFor="live-audio-file" 
                            className="flex-1 flex items-center justify-center gap-1.5 bg-slate-950 border border-slate-855 hover:border-indigo-500/40 p-2.5 rounded-xl cursor-pointer text-xs text-slate-400 hover:text-white transition-colors"
                          >
                            <FileUp className="w-3.5 h-3.5 text-indigo-400" />
                            上傳大會音訊錄音檔
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Panel B - Executive summary generated by Gemini */}
                    <div className="md:col-span-8 bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col h-[540px]">
                      <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-4 flex-shrink-0">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                          AI 智庫會議分析大綱 (Gemini Core Report)
                        </h3>
                        {session?.status === "recording" && (
                          <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> 背景生成中...
                          </span>
                        )}
                      </div>

                      <div className="flex-1 overflow-y-auto pr-1 text-xs/relaxed text-slate-300 space-y-4 font-sans scrollbar-thin">
                        {session?.summary && session.summary !== "等待語音或文字輸入中..." ? (
                          <article className="prose prose-invert prose-xs max-w-full space-y-3">
                            {session.summary.split("\n").map((line, i) => {
                              if (line.startsWith("# ")) {
                                return <h1 key={i} className="text-base font-bold text-white border-b border-slate-800 pb-1 mt-4">{line.replace("# ", "")}</h1>;
                              } else if (line.startsWith("## ")) {
                                return <h2 key={i} className="text-sm font-bold text-white mt-4 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-indigo-400" /> {line.replace("## ", "")}</h2>;
                              } else if (line.startsWith("### ")) {
                                return <h3 key={i} className="text-xs font-semibold text-slate-100 mt-2">{line.replace("### ", "")}</h3>;
                              } else if (line.startsWith("- ") || line.startsWith("* ")) {
                                return (
                                  <li key={i} className="ml-4 list-disc text-slate-300 leading-normal">
                                    {line.replace(/^[-*]\s+/, "")}
                                  </li>
                                );
                              } else if (line.trim() === "") {
                                return <div key={i} className="h-2" />;
                              } else {
                                return <p key={i} className="text-slate-300 tracking-tight leading-relaxed">{line}</p>;
                              }
                            })}
                          </article>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                            <Sparkles className="w-12 h-12 stroke-1 text-slate-600 mb-3" />
                            <p className="text-sm font-semibold text-slate-400">尚無分析大綱</p>
                            <p className="text-xs max-w-[280px] mt-1 leading-normal text-slate-500">
                              當終端開始進行會議對談（不論是錄音或是輸入決策點），Gemini 模型會在背景自動更新為精美、結構化的專業整理。
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Bento row 2: SVG dynamic mindmap and checklist */}
                  <div className="grid md:grid-cols-2 gap-6">
                    
                    {/* Left block Checklist tracker */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6">
                      <h3 className="text-sm font-semibold text-white pb-4 border-b border-slate-800 mb-4 flex items-center gap-1.5">
                        <CheckSquare className="w-4 h-4 text-sky-400" />
                        會議實施待辦跟蹤 (TODO Assignments)
                      </h3>

                      <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                        {session?.todos && session.todos.length > 0 ? (
                          session.todos.map((todo) => (
                            <div 
                              key={todo.id} 
                              onClick={async () => {
                                // Double action to toggle item live
                                const updated = session.todos.map(t => t.id === todo.id ? { ...t, done: !t.done } : t);
                                await saveMeetingModification(session.roomId, { todos: updated });
                              }}
                              className="flex items-center justify-between p-3.5 bg-slate-850/40 border border-slate-805 rounded-2xl hover:border-slate-700 transition cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-3">
                                <span className={`p-1 rounded text-[10px] font-semibold border ${
                                  todo.done 
                                    ? "bg-slate-800 text-slate-500 border-slate-700 line-through" 
                                    : "bg-indigo-500/10 text-indigo-400 border-indigo-500/15"
                                }`}>
                                  {todo.category}
                                </span>
                                <span className={`text-xs font-semibold ${
                                  todo.done ? "text-slate-500 line-through font-normal" : "text-slate-100"
                                }`}>
                                  {todo.text}
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-4">
                                <span className="text-[10px] bg-slate-800 text-slate-400 px-2.5 py-0.5 rounded-full border border-slate-700">
                                  @{todo.assignee}
                                </span>
                                <span className={todo.done ? "text-emerald-400" : "text-slate-600"}>
                                  {todo.done ? <CheckSquare className="w-4.5 h-4.5" /> : <Square className="w-4.5 h-4.5" />}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-14 border border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center text-center text-slate-500">
                            <CheckSquare className="w-8 h-8 text-slate-600 mb-2" />
                            <p className="text-xs font-semibold text-slate-400">無待辦事項記錄</p>
                            <p className="text-[10px] text-slate-500 mt-1">Gemini 智囊會根據對話語氣智能提取各人任務</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right SVG mind map visualizer */}
                    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col h-fit">
                      <h3 className="text-sm font-semibold text-white pb-4 border-b border-slate-800 mb-4 flex items-center gap-1.5">
                        <Layers className="w-4 h-4 text-emerald-400" />
                        AI 語脈邏輯思考心智圖 (Concept Canvas)
                      </h3>

                      {layedNodes.length > 0 ? (
                        <div className="border border-slate-950 bg-slate-950/40 rounded-2xl overflow-hidden p-2 relative">
                          <svg width="100%" height="280" viewBox="0 0 680 300" className="mx-auto block">
                            {/* Connecting Paths */}
                            {layedNodes.map(node => {
                              if (!node.parentId) return null;
                              const parent = layedNodes.find(p => p.id === node.parentId);
                              if (!parent) return null;

                              const controlX1 = parent.x + (node.x > parent.x ? 50 : -50);
                              const controlX2 = node.x - (node.x > parent.x ? 50 : -50);
                              const d = `M ${parent.x} ${parent.y} C ${controlX1} ${parent.y}, ${controlX2} ${node.y}, ${node.x} ${node.y}`;

                              return (
                                <path 
                                  key={`link-${node.id}`} 
                                  d={d} 
                                  fill="none" 
                                  stroke={node.type === "action" ? "#38bdf8" : "#818cf8"} 
                                  strokeWidth="1.5" 
                                  strokeOpacity="0.4"
                                  strokeDasharray={node.type === "action" ? "3,3" : "none"}
                                />
                              );
                            })}

                            {/* Nodes */}
                            {layedNodes.map(node => (
                              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                                <rect
                                  x={node.id === "root" ? -60 : -55}
                                  y={-14}
                                  width={node.id === "root" ? 120 : 110}
                                  height={28}
                                  rx={8}
                                  fill={
                                    node.id === "root" 
                                      ? "#4f46e5" 
                                      : node.type === "action" 
                                        ? "#022c22" 
                                        : "#0f172a"
                                  }
                                  stroke={
                                    node.id === "root"
                                      ? "#6366f1"
                                      : node.type === "action"
                                        ? "#059669"
                                        : "#334155"
                                  }
                                  strokeWidth="1"
                                  className="transition duration-155 transform hover:scale-105 cursor-pointer"
                                />
                                <text
                                  textAnchor="middle"
                                  y={4}
                                  fill={node.id === "root" ? "#ffffff" : node.type === "action" ? "#34d399" : "#cbd5e1"}
                                  fontSize={node.id === "root" ? "10" : "9"}
                                  fontWeight={node.id === "root" ? "bold" : "normal"}
                                  className="select-none font-sans"
                                >
                                  {node.label.length > 9 ? `${node.label.slice(0, 8)}...` : node.label}
                                </text>
                              </g>
                            ))}
                          </svg>
                          
                          <div className="absolute top-3 right-3 flex gap-2 text-[9px] uppercase font-mono bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg text-slate-400">
                            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />主題</span>
                            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#059669]" />行動</span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-14 border border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center text-center text-slate-500">
                          <Layers className="w-8 h-8 text-slate-600 mb-2" />
                          <p className="text-xs font-semibold text-slate-400">心智樹尚未分化</p>
                          <p className="text-[10px] text-slate-500 mt-1">隨著會議深入推進，討論要點將分支為概念網</p>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* ==================== SUB-VIEW B: HIGH-END MEETING HISTORY MANAGER ==================== */}
              {hostTab === "history" && (
                <div className="grid md:grid-cols-12 gap-6">
                  
                  {/* Left Column: Meetings history selector checklist */}
                  <div className="md:col-span-4 bg-slate-900/50 border border-slate-800 rounded-3xl p-5 flex flex-col h-[680px]">
                    <div className="pb-3 border-b border-slate-800 mb-3">
                      <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest block mb-2">歷史會期清單匯集</span>
                      <input 
                        type="text"
                        placeholder="🔍 搜尋主題或日期關鍵字..."
                        value={clientBrowseSearch}
                        onChange={(e) => setClientBrowseSearch(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs text-white outline-none placeholder:text-slate-600 focus:border-indigo-500 transition"
                      />
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
                      {isLoadingMeetings ? (
                        <div className="py-10 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                          <RefreshCw className="w-5 h-5 animate-spin text-indigo-400" />
                          正在自後端調閱歷史卷宗...
                        </div>
                      ) : meetingsList.filter(m => 
                        m.title.toLowerCase().includes(clientBrowseSearch.toLowerCase()) ||
                        m.roomId.toLowerCase().includes(clientBrowseSearch.toLowerCase()) ||
                        m.meetingDate.toLowerCase().includes(clientBrowseSearch.toLowerCase())
                      ).length === 0 ? (
                        <p className="text-xs text-slate-500 py-10 text-center italic">無符合之歷史會期</p>
                      ) : (
                        meetingsList.filter(m => 
                          m.title.toLowerCase().includes(clientBrowseSearch.toLowerCase()) ||
                          m.roomId.toLowerCase().includes(clientBrowseSearch.toLowerCase()) ||
                          m.meetingDate.toLowerCase().includes(clientBrowseSearch.toLowerCase())
                        ).map((m) => (
                          <div 
                            key={m.roomId}
                            onClick={() => loadHistoryMeetingDetail(m.roomId)}
                            className={`p-3.5 rounded-2xl border transition text-left cursor-pointer select-none space-y-1.5 ${
                              selectedHistoryMeeting?.roomId === m.roomId
                                ? "bg-indigo-650/25 border-indigo-500/80 shadow-md shadow-indigo-650/5 pl-4"
                                : "bg-slate-950/40 border-slate-850 hover:bg-slate-850/50 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-emerald-400 font-bold font-mono uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/15">
                                #{m.roomId}
                              </span>
                              <span className="text-slate-500 font-mono font-bold flex items-center gap-1">
                                <Calendar className="w-2.5 h-2.5" /> {m.meetingDate}
                              </span>
                            </div>

                            <p className="text-xs font-bold text-slate-100 line-clamp-1 group-hover:text-indigo-400 transition-colors">
                              {m.title}
                            </p>

                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1.5 text-[9px] text-slate-400 border-t border-slate-850/50">
                              <span className="font-medium">逐字稿: <b className="text-slate-200">{m.segmentsCount}條</b></span>
                              <span className="font-medium">待辦: <b className="text-slate-200">{m.todosCount}項</b></span>
                              <span className="font-medium">錄音: <b className="text-slate-200">{m.recordingsCount}首</b></span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Right Column: In-depth retroactive workspace */}
                  <div className="md:col-span-8 h-[680px] flex flex-col bg-slate-900/50 border border-slate-800 rounded-3xl p-6 overflow-y-auto scrollbar-thin space-y-6">
                    {selectedHistoryMeeting ? (
                      <>
                        {/* Editor Header: Title & date */}
                        <div className="bg-slate-950 border border-slate-850 rounded-2xl p-5 space-y-3 relative">
                          <div className="flex flex-wrap justify-between items-start gap-3">
                            <div className="space-y-1.5 flex-1">
                              {isEditingTitle ? (
                                <div className="flex gap-2">
                                  <input 
                                    type="text" 
                                    value={editTitleVal} 
                                    onChange={(e) => setEditTitleVal(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 text-sm font-bold text-white rounded-lg px-3 py-1 flex-1 outline-none focus:border-indigo-500"
                                  />
                                  <button 
                                    onClick={async () => {
                                      await saveMeetingModification(selectedHistoryMeeting.roomId, { title: editTitleVal });
                                      setIsEditingTitle(false);
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded-lg"
                                  >
                                    儲存
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 group">
                                  <h2 className="text-base font-bold text-white tracking-tight">{selectedHistoryMeeting.title || `會議室 ${selectedHistoryMeeting.roomId}`}</h2>
                                  <button onClick={() => setIsEditingTitle(true)} className="text-slate-500 hover:text-indigo-400 transition cursor-pointer">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}

                              {isEditingDate ? (
                                <div className="flex gap-2 items-center">
                                  <input 
                                    type="date"
                                    value={editDateVal}
                                    onChange={(e) => setEditDateVal(e.target.value)}
                                    className="bg-slate-900 border border-slate-700 text-xs text-indigo-300 rounded-lg px-2.5 py-1 outline-none"
                                  />
                                  <button 
                                    onClick={async () => {
                                      await saveMeetingModification(selectedHistoryMeeting.roomId, { meetingDate: editDateVal });
                                      setIsEditingDate(false);
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] px-2 py-0.5 rounded-md"
                                  >
                                    存
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold font-mono">
                                  <Calendar className="w-3.5 h-3.5" /> 
                                  <span>會期日期：{selectedHistoryMeeting.meetingDate || "未設定"}</span>
                                  <button onClick={() => setIsEditingDate(true)} className="text-slate-600 hover:text-indigo-400 cursor-pointer">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>

                            <span className="text-xs bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/15 font-mono font-bold">
                              房號：{selectedHistoryMeeting.roomId}
                            </span>
                          </div>
                        </div>

                        {/* Bento Row 1: Audio Archives & Text transcripts file pickers */}
                        <div className="grid sm:grid-cols-2 gap-6">
                          
                          {/* Audio uploads panel */}
                          <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl flex flex-col">
                            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-3">
                              <Mic className="w-4 h-4 text-indigo-400" /> 會議內嵌錄音專區 ({selectedHistoryMeeting.recordings?.length || 0})
                            </span>

                            <div className="space-y-2 mb-4 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
                              {(selectedHistoryMeeting.recordings || []).map((file, idx) => (
                                <div key={file.id} className="flex items-center justify-between p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                                  <div className="min-w-0 flex-1 pr-2">
                                    <p className="text-xs font-semibold text-slate-200 truncate font-mono">{file.name}</p>
                                    <span className="text-[9px] text-slate-500 font-mono block">
                                      Size: {file.size ? `${Math.round(file.size / 1024)} KB` : "未知規格"} | {new Date(file.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <button 
                                    onClick={() => alert(`🔊 開始解析音軌：${file.name}，正在本地通道進行還原模擬`)}
                                    className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-all cursor-pointer"
                                  >
                                    <Play className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              {(!selectedHistoryMeeting.recordings || selectedHistoryMeeting.recordings.length === 0) && (
                                <p className="text-[11px] text-slate-500 italic py-6 text-center">本場會議尚無錄製音軌檔案</p>
                              )}
                            </div>

                            <div className="mt-auto">
                              <input 
                                type="file" 
                                id="history-audio-upload" 
                                className="hidden" 
                                accept="audio/*" 
                                onChange={(e) => handleAudioFileUpload(e, selectedHistoryMeeting.roomId, true)} 
                              />
                              <label 
                                htmlFor="history-audio-upload" 
                                className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 p-3 rounded-xl cursor-pointer text-xs text-slate-400 hover:text-slate-100 transition-all text-center font-semibold"
                              >
                                <FileUp className="w-4 h-4 text-indigo-400" /> 上傳/載入錄音
                              </label>
                            </div>
                          </div>

                          {/* Text Transcribe uploader & trigger analysis */}
                          <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl flex flex-col">
                            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5 mb-3">
                              <FileText className="w-4 h-4 text-emerald-400" /> 文字稿導入與 AI 驅動
                            </span>
                            <p className="text-[11px] text-slate-500 leading-normal mb-4">
                              可手動上傳包含隨機討論段落的 `.txt` 檔案（一行代表一條記錄）以補充對話，接著點擊下方整體叫 AI 重繪智庫！
                            </p>

                            <div className="space-y-2 mt-auto">
                              <input 
                                type="file" 
                                id="history-transcript-upload" 
                                className="hidden" 
                                accept=".txt" 
                                onChange={(e) => handleTranscriptFileUpload(e, selectedHistoryMeeting.roomId, true)} 
                              />
                              <label 
                                htmlFor="history-transcript-upload" 
                                className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 p-3 rounded-xl cursor-pointer text-xs text-slate-400 hover:text-slate-100 transition-all text-center font-semibold mb-2"
                              >
                                <FileUp className="w-4 h-4 text-emerald-400 animate-bounce" /> 導入文字逐字稿 (.txt)
                              </label>

                              {/* Trigger direct Gemini analysis of that meeting */}
                              <button
                                onClick={async () => {
                                  if (!geminiApiKey) {
                                    alert("請先在設定中配置 GEMINI_API_KEY！");
                                    return;
                                  }
                                  try {
                                    alert(`🚀 開始驅動 Gemini 剖析會議歷史：${selectedHistoryMeeting.title}...\n全量消化逐字稿片段，重新渲染大綱與概念腦圖。請稍候！`);
                                    setSelectedHistoryMeeting(prev => prev ? { ...prev, status: "analyzing" } : null);
                                    
                                    const analysisResult = await analyzeMeetingClientSide(
                                      geminiApiKey,
                                      selectedHistoryMeeting.segments || [],
                                      selectedModel
                                    );
                                    
                                    const updated: RoomSession = {
                                      ...selectedHistoryMeeting,
                                      summary: analysisResult.summary,
                                      todos: analysisResult.todos.map((t, idx) => ({
                                        id: `todo-${Date.now()}-${idx}`,
                                        text: t.text,
                                        assignee: t.assignee,
                                        category: t.category,
                                        done: false
                                      })),
                                      mindmap: analysisResult.mindmap,
                                      status: "active"
                                    };
                                    
                                    await saveRoom(updated);
                                    setSelectedHistoryMeeting(updated);
                                    fetchMeetingsList();
                                    addLog(`智庫分析重新梳理完成：${selectedHistoryMeeting.roomId}`);
                                  } catch (e: any) {
                                    console.error("Manual reanalysis trigger error", e);
                                    alert(`分析重構失敗: ${e.message}`);
                                    loadHistoryMeetingDetail(selectedHistoryMeeting.roomId);
                                  }
                                }}
                                disabled={selectedHistoryMeeting.status === "analyzing" || !selectedHistoryMeeting.segments?.length}
                                className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800/10 text-white disabled:text-slate-500 text-xs font-bold py-3 rounded-xl transition duration-150 cursor-pointer disabled:cursor-not-allowed"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                                {selectedHistoryMeeting.status === "analyzing" ? "Gemini 直連重解中..." : "整體叫 AI 智庫整合處理"}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Bento Row 2: Manual segments lists Timeline editor */}
                        <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl">
                          <span className="text-xs font-semibold text-slate-300 block mb-3 font-mono">
                            📜 會議文字稿軌跡編輯軌 (共 {selectedHistoryMeeting.segments?.length || 0} 段)
                          </span>

                          <div className="max-h-56 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                            {selectedHistoryMeeting.segments?.map((seg, sIdx) => (
                              <div key={seg.id} className="p-3 bg-slate-900/60 border border-slate-805 rounded-xl text-left relative group">
                                <div className="flex justify-between items-center mb-1 text-[10px] font-mono font-semibold text-slate-400">
                                  <span>{seg.sender}:</span>
                                  <div className="flex items-center gap-2">
                                    <span>{new Date(seg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    <button 
                                      onClick={async () => {
                                        const proceed = confirm("確認要駁回並刪除這條發言軌跡嗎？");
                                        if (proceed) {
                                          const filtered = selectedHistoryMeeting.segments.filter(s => s.id !== seg.id);
                                          await saveMeetingModification(selectedHistoryMeeting.roomId, { segments: filtered });
                                        }
                                      }}
                                      className="text-rose-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      刪除
                                    </button>
                                  </div>
                                </div>
                                
                                <input 
                                  type="text" 
                                  defaultValue={seg.text} 
                                  onBlur={async (e) => {
                                    if (e.target.value !== seg.text) {
                                      const edited = selectedHistoryMeeting.segments.map(s => s.id === seg.id ? { ...s, text: e.target.value } : s);
                                      await saveMeetingModification(selectedHistoryMeeting.roomId, { segments: edited });
                                    }
                                  }}
                                  className="bg-transparent border-none text-xs text-slate-100 w-full font-medium outline-none focus:bg-slate-950 px-1.5 py-0.5 rounded focus:border-indigo-500"
                                />
                              </div>
                            ))}
                            {(!selectedHistoryMeeting.segments || selectedHistoryMeeting.segments.length === 0) && (
                              <p className="text-[11px] text-slate-500 text-center py-8 italic border border-dashed border-slate-800 rounded-xl">
                                暫無發言逐字稿，可手動打字，或導入文本檔案。
                              </p>
                            )}
                          </div>
                          
                          {/* Manual insert element */}
                          <form 
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const sInput = form.elements.namedItem("item-sender") as HTMLInputElement;
                              const cInput = form.elements.namedItem("item-content") as HTMLInputElement;
                              if (!cInput.value.trim()) return;

                              const newItem = {
                                id: `seg-manual-${Date.now()}`,
                                timestamp: Date.now(),
                                sender: sInput.value.trim() || "手動紀錄",
                                text: cInput.value.trim(),
                                isVoice: false
                              };

                              const updated = [...(selectedHistoryMeeting.segments || []), newItem];
                              await saveMeetingModification(selectedHistoryMeeting.roomId, { segments: updated });
                              cInput.value = "";
                            }}
                            className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-850"
                          >
                            <input 
                              type="text" 
                              name="item-sender"
                              placeholder="紀錄講者 (例: 特助)"
                              className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-1.5 w-32 outline-none"
                            />
                            <input 
                              type="text" 
                              name="item-content"
                              placeholder="手動輸入補充會議發言紀錄..."
                              className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-1.5 flex-1 outline-none"
                            />
                            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3.5 py-2 rounded-lg font-bold">
                              插入
                            </button>
                          </form>
                        </div>

                        {/* Bento Row 3: Markdown report summary editor */}
                        <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl flex flex-col text-left">
                          <div className="flex justify-between items-center mb-3">
                            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-amber-300" /> AI 智庫精選大綱手改與修訂
                            </span>
                            
                            <button 
                              onClick={async () => {
                                if (isEditingSummary) {
                                  await saveMeetingModification(selectedHistoryMeeting.roomId, { summary: editSummaryVal });
                                }
                                setIsEditingSummary(!isEditingSummary);
                              }}
                              className="text-xs text-indigo-400 hover:text-white font-bold flex items-center gap-1 cursor-pointer bg-indigo-900/20 px-2.5 py-1 rounded"
                            >
                              {isEditingSummary ? <><Save className="w-3 h-3" /> 保存大綱</> : <><Pencil className="w-3 h-3" /> 修改大綱</>}
                            </button>
                          </div>

                          {isEditingSummary ? (
                            <textarea
                              value={editSummaryVal}
                              onChange={(e) => setEditSummaryVal(e.target.value)}
                              rows={10}
                              className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 text-xs font-mono text-slate-100 outline-none focus:border-indigo-500"
                            />
                          ) : (
                            <div className="bg-slate-900/30 border border-slate-850 p-4 rounded-xl max-h-60 overflow-y-auto text-xs/relaxed text-slate-300 scrollbar-thin">
                              {selectedHistoryMeeting.summary ? (
                                <article className="prose prose-invert prose-xs">
                                  {selectedHistoryMeeting.summary.split("\n").map((line, i) => {
                                    if (line.startsWith("# ")) return <h1 key={i} className="text-sm font-bold text-slate-100 border-b border-slate-800 pb-1 mt-2">{line.replace("# ", "")}</h1>;
                                    if (line.startsWith("## ")) return <h2 key={i} className="text-xs font-bold text-indigo-300 mt-2 flex items-center gap-1">{line.replace("## ", "")}</h2>;
                                    if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="ml-3 list-disc text-slate-300">{line.replace(/^[-*]\s+/, "")}</li>;
                                    if (line.trim() === "") return <div key={i} className="h-1.5" />;
                                    return <p key={i} className="text-slate-300">{line}</p>;
                                  })}
                                </article>
                              ) : (
                                <p className="text-slate-500 italic">暫無分析大綱報告</p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Bento Row 4: TODOs checkboxes and deletions */}
                        <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl flex flex-col">
                          <span className="text-xs font-semibold text-slate-300 block mb-3">
                            📋 任務分工與細部修改 (Checklist Tracker)
                          </span>

                          <div className="space-y-2 mb-3">
                            {selectedHistoryMeeting.todos?.map((todo, idx) => (
                              <div key={todo.id} className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                                <div className="flex items-center gap-2 flex-1 pr-2">
                                  <input 
                                    type="checkbox" 
                                    checked={todo.done}
                                    onChange={async () => {
                                      const updated = selectedHistoryMeeting.todos.map(t => t.id === todo.id ? { ...t, done: !t.done } : t);
                                      await saveMeetingModification(selectedHistoryMeeting.roomId, { todos: updated });
                                    }}
                                    className="accent-indigo-500 rounded cursor-pointer"
                                  />
                                  <span className={`text-xs ml-1 ${todo.done ? "text-slate-500 line-through font-normal" : "text-slate-200 font-semibold"}`}>
                                    {todo.text}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className="text-[10px] bg-slate-850 text-slate-400 border border-slate-800 px-2.5 py-0.5 rounded-full font-bold">
                                    @{todo.assignee}
                                  </span>
                                  <button 
                                    onClick={async () => {
                                      const updated = selectedHistoryMeeting.todos.filter(t => t.id !== todo.id);
                                      await saveMeetingModification(selectedHistoryMeeting.roomId, { todos: updated });
                                    }}
                                    className="text-rose-500 hover:text-white text-[10px] p-1 font-bold rounded cursor-pointer"
                                  >
                                    刪除
                                  </button>
                                </div>
                              </div>
                            ))}
                            {(!selectedHistoryMeeting.todos || selectedHistoryMeeting.todos.length === 0) && (
                              <p className="text-[11px] text-slate-500 text-center py-6">此期會目前無待辦任務紀錄</p>
                            )}
                          </div>

                          {/* Quick append custom todo item form */}
                          <form 
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const textIn = form.elements.namedItem("todo-text") as HTMLInputElement;
                              const assigneeIn = form.elements.namedItem("todo-assignee") as HTMLInputElement;
                              const categoryIn = form.elements.namedItem("todo-cat") as HTMLInputElement;
                              if (!textIn.value.trim()) return;

                              const item: TodoItem = {
                                id: `todo-manual-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                                text: textIn.value.trim(),
                                assignee: assigneeIn.value.trim() || "成員",
                                category: categoryIn.value.trim() || "一般",
                                done: false
                              };

                              const updated = [...(selectedHistoryMeeting.todos || []), item];
                              await saveMeetingModification(selectedHistoryMeeting.roomId, { todos: updated });
                              textIn.value = "";
                            }}
                            className="bg-slate-900 border border-slate-850 p-3 rounded-xl flex flex-wrap items-center gap-2"
                          >
                            <input 
                              type="text" 
                              name="todo-text" 
                              placeholder="待辦建議或實施工程描述..." 
                              className="bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg flex-1 outline-none focus:border-indigo-500"
                            />
                            <input 
                              type="text" 
                              name="todo-assignee" 
                              placeholder="成員小王" 
                              className="bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg w-24 outline-none focus:border-indigo-500"
                            />
                            <input 
                              type="text" 
                              name="todo-cat" 
                              placeholder="前端" 
                              className="bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg w-20 outline-none focus:border-indigo-500"
                            />
                            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3.5 py-1.5 rounded-lg font-bold">
                              新增任務
                            </button>
                          </form>
                        </div>

                        {/* Bento Row 5: Mindmap SVG and direct append tool */}
                        <div className="bg-slate-950/60 border border-slate-850 p-5 rounded-2xl flex flex-col select-none">
                          <span className="text-xs font-semibold text-slate-300 block mb-3">
                            🕸️ 精美決策思考心智樹大腦 (SVG Dynamic Node Network)
                          </span>

                          <div className="border border-slate-950 bg-slate-950/40 rounded-xl overflow-hidden p-2 relative mb-4">
                            {selectedHistoryMeeting.mindmap?.length > 0 ? (
                              <svg width="100%" height="280" viewBox="0 0 680 300" className="mx-auto block">
                                {getLayedNodesForMap(selectedHistoryMeeting.mindmap).map(node => {
                                  if (!node.parentId) return null;
                                  const parent = getLayedNodesForMap(selectedHistoryMeeting.mindmap).find(p => p.id === node.parentId);
                                  if (!parent) return null;

                                  const controlX1 = parent.x + (node.x > parent.x ? 50 : -50);
                                  const controlX2 = node.x - (node.x > parent.x ? 50 : -50);
                                  const d = `M ${parent.x} ${parent.y} C ${controlX1} ${parent.y}, ${controlX2} ${node.y}, ${node.x} ${node.y}`;

                                  return (
                                    <path 
                                      key={`link-${node.id}`} 
                                      d={d} 
                                      fill="none" 
                                      stroke={node.type === "action" ? "#38bdf8" : "#818cf8"} 
                                      strokeWidth="1.5" 
                                      strokeOpacity="0.45"
                                      strokeDasharray={node.type === "action" ? "3,3" : "none"}
                                    />
                                  );
                                })}

                                {getLayedNodesForMap(selectedHistoryMeeting.mindmap).map(node => (
                                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                                    <rect
                                      x={node.id === "root" ? -60 : -55}
                                      y={-14}
                                      width={node.id === "root" ? 120 : 110}
                                      height={28}
                                      rx={8}
                                      fill={
                                        node.id === "root" 
                                          ? "#4f46e5" 
                                          : node.type === "action" 
                                            ? "#022c22" 
                                            : "#0f172a"
                                      }
                                      stroke={
                                        node.id === "root"
                                          ? "#6366f1"
                                          : node.type === "action"
                                            ? "#059669"
                                            : "#334155"
                                      }
                                      strokeWidth="1"
                                      className="transition duration-150 transform hover:scale-105 cursor-pointer"
                                    />
                                    <text
                                      textAnchor="middle"
                                      y={4}
                                      fill={node.id === "root" ? "#ffffff" : node.type === "action" ? "#34d399" : "#cbd5e1"}
                                      fontSize={node.id === "root" ? "9" : "8"}
                                      fontWeight={node.id === "root" ? "bold" : "normal"}
                                      className="select-none font-sans"
                                    >
                                      {node.label.length > 9 ? `${node.label.slice(0, 8)}...` : node.label}
                                    </text>
                                  </g>
                                ))}
                              </svg>
                            ) : (
                              <p className="text-slate-500 italic text-center py-10">此歷史會議尚無生成心智腦圖</p>
                            )}
                          </div>

                          {/* Quick append mindmap label Form */}
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const labelVal = form.elements.namedItem("node-label") as HTMLInputElement;
                              const parentVal = form.elements.namedItem("parent-select") as HTMLSelectElement;
                              const typeVal = form.elements.namedItem("type-select") as HTMLSelectElement;
                              if (!labelVal.value.trim()) return;

                              const item: MindmapNode = {
                                id: `node-${Date.now()}-${Math.random().toString(36).substring(2, 4)}`,
                                label: labelVal.value.trim(),
                                parentId: parentVal.value || "root",
                                type: typeVal.value as any
                              };

                              const updated = [...(selectedHistoryMeeting.mindmap || []), item];
                              await saveMeetingModification(selectedHistoryMeeting.roomId, { mindmap: updated });
                              labelVal.value = "";
                            }}
                            className="bg-slate-900 border border-slate-850 p-3 rounded-xl flex flex-wrap items-center gap-2"
                          >
                            <input 
                              type="text" 
                              name="node-label" 
                              placeholder="新設分支概念標籤 (例: 安全防堵)" 
                              className="bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg flex-1 min-w-[150px] outline-none"
                            />
                            
                            <select name="parent-select" className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 outline-none">
                              <option value="root">連結至核心主題</option>
                              {selectedHistoryMeeting.mindmap?.filter(n => n.id !== "root" && !n.parentId).map(n => (
                                <option key={n.id} value={n.id}>分支: {n.label}</option>
                              ))}
                            </select>

                            <select name="type-select" className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 outline-none">
                              <option value="detail">主題概念 (Topic / Detail)</option>
                              <option value="action">待辦行動分支 (Action)</option>
                            </select>

                            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-1.5 rounded-lg font-bold">
                              插入節點
                            </button>
                          </form>
                        </div>
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-12 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                        <Calendar className="w-16 h-16 stroke-1 text-slate-700 mb-4 animate-bounce" />
                        <h4 className="text-sm font-bold text-slate-300">未選取任何歷史會議</h4>
                        <p className="text-xs text-slate-500 max-w-[280px] mt-1.5 leading-normal">
                          請於左方點擊查閱某一日的會議，即可開啟 inline 編輯面板、載入文字逐字稿檔、加載錄音包，或是整體智囊 AI 重組大會。
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ==================== SUB-VIEW C: HOST PROPOSAL AUDITING QUEUE ==================== */}
              {hostTab === "audit" && (
                <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col h-[680px]">
                  <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                        <CheckSquare className="w-4 h-4 text-amber-400" />
                        前端發言與提案建議審核中心 (Client Submission Audit Control)
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">此處展示來自發言終端 (Clients) 的連線建議上傳，核准通過後自動寫入對應的歷史期會區塊中。</p>
                    </div>

                    <button 
                      onClick={fetchPendingAudits}
                      className="p-2 border border-slate-700 hover:border-indigo-500 hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isLoadingAudits ? (
                    <div className="py-20 text-center text-xs text-indigo-300 flex flex-col items-center gap-2 font-mono">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      正在提取同步審核緩衝區...
                    </div>
                  ) : pendingAudits.filter(a => a.status === "pending").length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
                      <CheckSquare className="w-16 h-16 stroke-1 text-emerald-500 mb-3" />
                      <p className="text-sm font-bold text-slate-305">🎉 超乎預期，目前無待審決策提案！</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
                        當前連接終端拋轉的文字稿、新建待辦等將在前端發起。主機會立刻於此列隊，等待主辦人逐條簽發！
                      </p>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-4 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                      {pendingAudits.filter(a => a.status === "pending").map((sub) => (
                        <div key={sub.id} className="bg-slate-950 border border-slate-850 rounded-2xl p-5 hover:border-slate-700 transition flex flex-col shadow-lg">
                          
                          <div className="flex items-center justify-between pb-3 border-b border-slate-900 mb-3.5 text-[10px] font-mono">
                            <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                              類別：{
                                sub.type === "todo" ? "📋 新增待辦" :
                                sub.type === "voice" ? "🎤 錄製語音建議" :
                                sub.type === "text" ? "📝 補充文字稿" :
                                sub.type === "summary" ? "📊 大綱修補" : "🕸️ 腦圖標籤"
                              }
                            </span>
                            <span className="text-slate-500 font-semibold">
                              {new Date(sub.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="space-y-2 flex-1 mb-4 text-left">
                            <div className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                              <span>指向會期：</span>
                              <span className="text-indigo-300 font-bold underline">[{sub.meetingTitle || sub.roomId}]</span>
                            </div>
                            
                            <div className="text-[11px] text-slate-405 font-medium">
                              <span>發起作者：</span>
                              <span className="text-slate-200 font-bold">{sub.submittedBy}</span>
                            </div>

                            {sub.type === "voice" ? (
                              <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <p className="text-xs font-bold text-indigo-400 flex items-center gap-1">
                                    <PhoneCall className="w-3.5 h-3.5 text-rose-400 animate-pulse" /> 聲波語音包安全代辦
                                  </p>
                                  <p className="text-[9px] text-slate-500 font-mono">
                                    MimeType: {sub.additionalInfo?.voiceMime || "audio/webm"} (點擊通過將調用 Gemini 超高速辨識)
                                  </p>
                                </div>
                                <Play className="w-4 h-4 text-emerald-400 cursor-pointer" onClick={() => alert("模擬試聽極限縮寫... 點選下方核准立即在伺服器端完成辨識寫入!")} />
                              </div>
                            ) : (
                              <div className="p-3 bg-slate-900/40 border border-slate-860 rounded-xl text-xs text-slate-100 font-medium whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
                                "{sub.content}"
                              </div>
                            )}

                            {sub.type === "todo" && (
                              <div className="flex flex-wrap gap-2 text-[9px] font-mono font-bold mt-2.5">
                                <span className="bg-indigo-900/30 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">指派人員: @{sub.additionalInfo?.assignee || "未指定"}</span>
                                <span className="bg-emerald-950/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/15">任務部門: {sub.additionalInfo?.category || "一般"}</span>
                              </div>
                            )}

                            {sub.type === "mindmap" && (
                              <div className="flex flex-wrap gap-2 text-[9px] font-mono font-bold mt-2.5">
                                <span className="bg-[#0f172a] text-[#818cf8] px-2 py-0.5 rounded border border-[#334155]">父級節點: ID({sub.additionalInfo?.parentId || "root"})</span>
                                <span className="bg-[#022c22] text-[#34d399] px-2 py-0.5 rounded border border-[#059669]">特徵: {sub.additionalInfo?.nodeType || "detail"}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-auto pt-3 border-t border-slate-900">
                            <button 
                              onClick={() => handleAuditReview(sub.id, "approved")}
                              className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 hover:scale-102 font-extrabold text-xs text-white py-2.5 rounded-xl transition duration-150 cursor-pointer text-center"
                            >
                              <Check className="w-3.5 h-3.5" /> 通過簽發
                            </button>
                            <button 
                              onClick={() => handleAuditReview(sub.id, "rejected")}
                              className="flex-shrink-0 bg-slate-800 hover:bg-rose-500/25 border border-slate-700 hover:border-rose-500/30 p-2.5 rounded-xl transition duration-150 cursor-pointer text-slate-400 hover:text-rose-300"
                              title="驳回不存"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

        {/* ==================== 3. CLIENT / TRANSMITTER VOICE PANEL ==================== */}
        {role === "client" && (
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
            
            {/* Client Top Tab Pill Switcher */}
            <div className="flex bg-slate-950/80 border border-slate-855 p-1 rounded-2xl w-full">
              <button
                onClick={() => {
                  setClientSection("remote-speak");
                }}
                className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wider transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                  clientSection === "remote-speak"
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Mic className="w-4.5 h-4.5 text-rose-400 animate-pulse" />
                🎤 直達連線發言
              </button>
              <button
                onClick={() => {
                  setClientSection("history-browse");
                  fetchMeetingsList();
                }}
                className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wider transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                  clientSection === "history-browse"
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <FileText className="w-4 h-4 text-indigo-400" />
                📂 調閱智庫會議
              </button>
              <button
                onClick={() => {
                  setClientSection("propose-center");
                  fetchMeetingsList();
                  if (meetingsList.length > 0 && !submitRoomId) {
                    setSubmitRoomId(meetingsList[0].roomId || roomId);
                  } else if (!submitRoomId) {
                    setSubmitRoomId(roomId);
                  }
                }}
                className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wider transition duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                  clientSection === "propose-center"
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <PlusCircle className="w-4 h-4 text-emerald-400 animate-bounce" />
                💡 發起建議提案
              </button>
            </div>

            {/* ==================== CLIENT PANE 1: INSTANT SPEAKER TRANSMITTER VOICE PACKAGES ==================== */}
            {clientSection === "remote-speak" && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden space-y-6">
                
                {/* Connected details */}
                <div className="flex justify-between items-center bg-slate-950 border border-slate-850/80 rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-medium text-slate-200">正在與大會主機進行即時連線</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1 rounded-full">
                    房號：{roomId}
                  </span>
                </div>

                {/* Central Dynamic Vocal Bubble */}
                <div className="flex flex-col items-center py-8">
                  
                  {/* Visual pulsating ripple rings base on dynamic volume input */}
                  <div className="relative flex items-center justify-center">
                    
                    {/* Energy Wave Ring Math */}
                    <AnimatePresence>
                      {isRecording && (
                        <>
                          <motion.div 
                            className="absolute w-36 h-36 border border-emerald-500/40 rounded-full"
                            initial={{ scale: 0.9, opacity: 0.5 }}
                            animate={{ 
                              scale: 1 + (voiceVolume / 140), 
                              opacity: 0 
                            }}
                            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
                          />
                          <motion.div 
                            className="absolute w-44 h-44 border border-emerald-500/10 rounded-full"
                            initial={{ scale: 0.8, opacity: 0.3 }}
                            animate={{ 
                              scale: 1 + (voiceVolume / 90), 
                              opacity: 0 
                            }}
                            transition={{ repeat: Infinity, duration: 1.8, ease: "easeOut", delay: 0.3 }}
                          />
                        </>
                      )}
                    </AnimatePresence>

                    <button
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                      onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                      className={`relative w-28 h-28 rounded-full flex flex-col items-center justify-center select-none shadow-2xl transition duration-300 transform active:scale-95 cursor-pointer ${
                        isRecording 
                          ? "bg-rose-600 text-white hover:bg-rose-500" 
                          : "bg-indigo-600 hover:bg-indigo-500 text-indigo-100 shadow-lg shadow-indigo-600/30"
                      }`}
                    >
                      {isRecording ? (
                        <>
                          <PhoneCall className="w-8 h-8 animate-bounce" />
                          <span className="text-[10px] font-bold uppercase mt-2 tracking-widest text-[#FFF]">發言中...</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-8 h-8" />
                          <span className="text-[10px] font-bold uppercase mt-2 tracking-widest">長按麥克風</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-6 text-center">
                    <p className="text-slate-350 font-medium text-xs">
                      {isRecording ? "放開按鈕即能完成語音包傳遞與翻譯" : "壓住按鈕即可向主持人發起發言"}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">音源經由直連傳遞，後端調配 Gemini 精準解析</p>
                  </div>

                </div>

                {/* Text Note inputs option */}
                <div className="border-t border-slate-800 pt-5 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-indigo-400" />
                    手動輸入文字建議與留言
                  </h4>
                  
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inputText.trim()) return;
                      sendContentParcel(inputText.trim());
                      setInputText("");
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      placeholder="輸入大會紀錄、重大決策或問題..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      className="bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 text-white rounded-full px-5 py-3 text-xs flex-1 outline-none transition placeholder:text-slate-600 font-medium"
                    />
                    <button 
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white p-3 rounded-full transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>

                {/* Local Feed segment mirror */}
                <div className="border-t border-slate-800 pt-5 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-emerald-400" />
                    會議片段狀態鏡像 (大會實時逐字)
                  </h4>
                  
                  <div className="bg-slate-950 border border-slate-850 rounded-2xl p-4 max-h-40 overflow-y-auto space-y-2.5 text-xs scrollbar-thin">
                    {session?.segments.length === 0 ? (
                      <p className="text-slate-500 text-[11px] italic text-center py-4">
                        尚未有最新發言，請開始說話或打字...
                      </p>
                    ) : (
                      session?.segments.map(seg => (
                        <div key={seg.id} className="p-3 border-l border-indigo-500 bg-slate-900/50 rounded-r-xl text-left">
                          <div className="flex justify-between items-center text-[9px] text-slate-505 font-mono">
                            <span className="font-bold">{seg.sender}</span>
                            <span>{new Date(seg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          <p className="text-slate-200 text-[11px] mt-1 font-medium">{seg.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* ==================== CLIENT PANE 2: READ-ONLY METRICS BROWSER (調閱會議) ==================== */}
            {clientSection === "history-browse" && (
              <div className="grid md:grid-cols-12 gap-6">
                
                {/* Left Mini selector */}
                <div className="md:col-span-4 bg-slate-900/50 border border-slate-800 p-5 rounded-3xl h-[600px] flex flex-col">
                  <span className="text-xs font-bold text-slate-450 uppercase mb-3 block">歷史會議彙總</span>
                  
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                    {meetingsList.length === 0 ? (
                      <p className="text-[11px] text-slate-550 py-10 italic">後端暂無任何歷史會議</p>
                    ) : (
                      meetingsList.map(m => (
                        <button
                          key={m.roomId}
                          onClick={async () => {
                            const room = await getRoom(m.roomId);
                            if (room) {
                              setClientSelectedViewMeeting(room);
                            }
                          }}
                          className={`w-full text-left p-3 rounded-xl border transition ${
                            clientSelectedViewMeeting?.roomId === m.roomId
                              ? "bg-indigo-650/15 border-indigo-500/60"
                              : "bg-slate-950 border-slate-850 hover:bg-slate-900"
                          }`}
                        >
                          <span className="text-[9px] font-mono font-bold text-slate-500 block">{m.meetingDate}</span>
                          <span className="text-xs font-bold text-slate-100 truncate block mt-0.5">{m.title}</span>
                          <span className="text-[9px] font-mono text-emerald-400 mt-1 block">[ #{m.roomId} ]</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Right detailed minutes review (Read-Only) */}
                <div className="md:col-span-8 bg-slate-900/50 border border-slate-800 p-6 rounded-3xl h-[600px] overflow-y-auto scrollbar-thin space-y-6 text-left">
                  {clientSelectedViewMeeting ? (
                    <>
                      {/* Document Details Info */}
                      <div className="pb-4 border-b border-slate-800 flex justify-between items-start gap-4 flex-wrap">
                        <div>
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/15 font-mono font-bold px-2 py-0.5 rounded">
                            唯讀查閱模組
                          </span>
                          <h2 className="text-sm font-bold text-white mt-2 leading-tight">{clientSelectedViewMeeting.title}</h2>
                          <div className="text-[11px] text-slate-400 font-semibold font-mono mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" /> 日期：{clientSelectedViewMeeting.meetingDate || "未紀實"}
                          </div>
                        </div>

                        {/* DOWNLOAD TRIGGERS BUTTON PACKAGE CONTAINER */}
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              // Download report as beautiful markdown
                              const content = `# 大會議長智庫會議紀要\n\n主題：${clientSelectedViewMeeting.title}\n建立時間：${clientSelectedViewMeeting.meetingDate}\n會議代號：${clientSelectedViewMeeting.roomId}\n\n## 1. 摘要大綱\n\n${clientSelectedViewMeeting.summary || "尚無總結"}\n\n## 2. 任務清單跟蹤\n\n${(clientSelectedViewMeeting.todos || []).map(t => `- [${t.done ? "X" : " "}] @${t.assignee}: ${t.text} (部門: ${t.category})`).join("\n")}`;
                              const blob = new Blob([content], { type: "text/markdown;charset=utf-8;" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `會議智庫紀要_${clientSelectedViewMeeting.roomId}.md`;
                              a.click();
                            }}
                            className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-850 hover:text-white border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                          >
                            <Download className="w-3 h-3 text-indigo-400" /> 下載 A4 智庫大綱 (.md)
                          </button>
                          <button
                            onClick={() => {
                              // Download full transcripts as simple speaker text
                              const recordsText = (clientSelectedViewMeeting.segments || []).map(s => `[${new Date(s.timestamp).toLocaleTimeString()}] ${s.sender}: ${s.text}`).join("\n");
                              const blob = new Blob([recordsText], { type: "text/plain;charset=utf-8;" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `逐字全紀錄文稿_${clientSelectedViewMeeting.roomId}.txt`;
                              a.click();
                            }}
                            className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-850 hover:text-white border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
                          >
                            <Download className="w-3 h-3 text-emerald-400" /> 下載全文逐字段 (.txt)
                          </button>
                        </div>
                      </div>

                      {/* Summary Section */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-white border-l-2 border-indigo-500 pl-2.5">
                          AI 智庫學理分析大綱
                        </h4>
                        <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-2xl max-h-44 overflow-y-auto text-xs/relaxed text-slate-300 scrollbar-thin whitespace-pre-wrap">
                          {clientSelectedViewMeeting.summary || "暫無生成總結。"}
                        </div>
                      </div>

                      {/* TODOs Assignments (Visual checkbox list) */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-white border-l-2 border-sky-400 pl-2.5">
                          會議實施待辦跟蹤 (Read-Only)
                        </h4>
                        <div className="space-y-2 max-h-44 overflow-y-auto pr-1 scrollbar-thin">
                          {(clientSelectedViewMeeting.todos || []).map(t => (
                            <div key={t.id} className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-850 rounded-xl">
                              <span className={`text-xs ${t.done ? "text-slate-500 line-through" : "text-slate-200 font-semibold"}`}>
                                {t.text}
                              </span>
                              
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-400 font-bold font-mono">
                                  @{t.assignee}
                                </span>
                                <span className={t.done ? "text-emerald-400" : "text-slate-600"}>
                                  {t.done ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                </span>
                              </div>
                            </div>
                          ))}
                          {(!clientSelectedViewMeeting.todos || clientSelectedViewMeeting.todos.length === 0) && (
                            <p className="text-[11px] text-slate-500 italic py-2">此主題下尚未指派任務待辦項目</p>
                          )}
                        </div>
                      </div>

                      {/* Mindmap canvas representation */}
                      <div className="space-y-2 pb-2">
                        <h4 className="text-xs font-semibold text-white border-l-2 border-emerald-400 pl-2.5/2">
                          AI 語脈邏輯思考心智腦圖
                        </h4>
                        
                        <div className="border border-slate-950/80 bg-slate-950/30 rounded-xl overflow-hidden p-1.5 relative">
                          {clientSelectedViewMeeting.mindmap?.length > 0 ? (
                            <svg width="100%" height="240" viewBox="0 0 680 300" className="mx-auto block">
                              {getLayedNodesForMap(clientSelectedViewMeeting.mindmap).map(node => {
                                if (!node.parentId) return null;
                                const parent = getLayedNodesForMap(clientSelectedViewMeeting.mindmap).find(p => p.id === node.parentId);
                                if (!parent) return null;

                                const d = `M ${parent.x} ${parent.y} C ${parent.x + (node.x > parent.x ? 50 : -50)} ${parent.y}, ${node.x - (node.x > parent.x ? 50 : -50)} ${node.y}, ${node.x} ${node.y}`;
                                return (
                                  <path 
                                    key={`cli-link-${node.id}`} 
                                    d={d} 
                                    fill="none" 
                                    stroke={node.type === "action" ? "#22d3ee" : "#818cf8"} 
                                    strokeWidth="1.5" 
                                    strokeOpacity="0.4"
                                  />
                                );
                              })}

                              {getLayedNodesForMap(clientSelectedViewMeeting.mindmap).map(node => (
                                <g key={`cli-node-${node.id}`} transform={`translate(${node.x}, ${node.y})`}>
                                  <rect
                                    x={-50}
                                    y={-12}
                                    width={100}
                                    height={24}
                                    rx={6}
                                    fill={node.id === "root" ? "#4f46e5" : node.type === "action" ? "#022c22" : "#0f172a"}
                                    stroke={node.id === "root" ? "#6366f1" : node.type === "action" ? "#059669" : "#334155"}
                                  />
                                  <text
                                    textAnchor="middle"
                                    y={3}
                                    fill={node.id === "root" ? "#ffffff" : node.type === "action" ? "#34d399" : "#cbd5e1"}
                                    fontSize="8"
                                  >
                                    {node.label.length > 9 ? `${node.label.slice(0, 8)}...` : node.label}
                                  </text>
                                </g>
                              ))}
                            </svg>
                          ) : (
                            <p className="text-[11px] text-slate-500 text-center py-10">尚無生成腦圖資訊</p>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-20 text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                      <FileUp className="w-12 h-12 stroke-1 text-slate-700 mb-2" />
                      <p className="text-xs font-semibold text-slate-400">請由左方選擇一場歷史會議來調閱</p>
                      <p className="text-[10px] text-slate-550 max-w-[200px] mt-1">您在此唯讀視窗中可流暢查閱所有摘要大綱、下載會議紀要，不具修改權限。</p>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* ==================== CLIENT PANE 3: PROPOSALS DRAWER (發起與上傳提案建議) ==================== */}
            {clientSection === "propose-center" && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 text-left space-y-5">
                
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <PlusCircle className="w-4 h-4 text-emerald-400 animate-pulse" />
                    發起決策建議與提案上傳 (Propose Recommendation)
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    您可以向特定的後端會期提送各類「文字稿補述、追加待辦任務、概念心智圖或錄製專長發言錄音包」，這些在送出後會被暫存至後端提案審核中心，待主席同意簽發後才會匯入實體！
                  </p>
                </div>

                {clientSubmitSuccessMsg && (
                  <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-2xl p-4 text-xs font-medium text-emerald-300 leading-relaxed">
                    {clientSubmitSuccessMsg}
                  </div>
                )}

                <form onSubmit={submitProposalFromClient} className="space-y-4">
                  
                  {/* Row 1: Target Meeting choice */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-400 block font-sans">1. 指定目標會期 (Target Meeting)</label>
                      <select
                        value={submitRoomId}
                        onChange={(e) => setSubmitRoomId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-xs text-slate-100 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500"
                        required
                      >
                        <option value="">-- 請選定 --</option>
                        <option value={roomId}>當下實時會議室: [#{roomId}]</option>
                        {meetingsList.map(m => (
                          <option key={m.roomId} value={m.roomId}>{m.title} (#{m.roomId})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-400 block font-sans">2. 提案署名 (Sender Title)</label>
                      <input 
                        type="text" 
                        placeholder="例：項目團隊_特助小王"
                        value={submitSender}
                        onChange={(e) => setSubmitSender(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 text-xs text-white rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  {/* Row 2: Proposal Type Selection */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 block">3. 選擇建議性質模組</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: "text", label: "📝 補充發言/逐字稿" },
                        { id: "todo", label: "📋 追新實施待辦" },
                        { id: "mindmap", label: "🕸️ 追加腦圖概念" },
                        { id: "voice", label: "🎤 發布帶辦聲效錄音" }
                      ].map(typeObj => (
                        <button
                          key={typeObj.id}
                          type="button"
                          onClick={() => {
                            setSubmitType(typeObj.id as any);
                            setClientSubmitSuccessMsg("");
                          }}
                          className={`p-3 rounded-xl border text-xs font-semibold text-center transition cursor-pointer ${
                            submitType === typeObj.id
                              ? "bg-indigo-650/25 border-indigo-500 text-indigo-300"
                              : "bg-slate-950 border-slate-850 text-slate-450 hover:bg-slate-900"
                          }`}
                        >
                          {typeObj.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Conditional Fields: Extra properties */}
                  {submitType === "todo" && (
                    <div className="grid sm:grid-cols-2 gap-4 bg-slate-950 p-4 border border-slate-850 rounded-2xl">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-400 block">指派落實同仁 (Assignee)</label>
                        <input 
                          type="text" 
                          placeholder="小強" 
                          value={todoAssignee}
                          onChange={(e) => setTodoAssignee(e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-indigo-500 w-full"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-400 block">指派任務範疇 (Category)</label>
                        <input 
                          type="text" 
                          placeholder="系統安全 / 部署 / 產品經理" 
                          value={todoCategory}
                          onChange={(e) => setTodoCategory(e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white outline-none focus:border-indigo-500 w-full"
                        />
                      </div>
                    </div>
                  )}

                  {submitType === "mindmap" && (
                    <div className="grid sm:grid-cols-2 gap-4 bg-slate-950 p-4 border border-slate-850 rounded-2xl">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-400 block">心智樹核心連入 (Parent ID)</label>
                        <select 
                          value={mindmapParentId}
                          onChange={(e) => setMindmapParentId(e.target.value)}
                          className="bg-slate-900 border border-slate-800 text-xs text-white rounded-lg p-2 outline-none w-full"
                        >
                          <option value="root">核心主題節點 (Root)</option>
                        </select>
                      </div>
                      <div className="space-y-1 font-sans">
                        <label className="text-[11px] font-bold text-slate-400 block">思考標籤權重屬性 (Node Type)</label>
                        <select 
                          value={mindmapNodeType}
                          onChange={(e) => setMindmapNodeType(e.target.value as any)}
                          className="bg-slate-900 border border-slate-800 text-xs text-white rounded-lg p-2 outline-none w-full"
                        >
                          <option value="topic">主題概念主題</option>
                          <option value="detail">一般細部細節</option>
                          <option value="action">待實施行動分支</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Row 3: Main TextArea Content OR Audio Vocal Proposal form */}
                  <div className="space-y-1.5 flex flex-col">
                    <label className="text-xs font-bold text-slate-400 block">
                      {submitType === "voice" ? "🎤 長按下方按鈕，直接為目標會議錄配提案音訊包" : "✍️ 輸入提案具體草案內容 (Draft Text Content)"}
                    </label>

                    {submitType === "voice" ? (
                      <div className="bg-slate-950 p-6 border border-slate-850 rounded-2xl flex flex-col items-center gap-4 text-center">
                        <div className="relative flex items-center justify-center">
                          <AnimatePresence>
                            {isRecording && (
                              <motion.div 
                                className="absolute w-24 h-24 border border-rose-500/30 rounded-full"
                                animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
                                transition={{ repeat: Infinity, duration: 1.5 }}
                              />
                            )}
                          </AnimatePresence>

                          <button
                            type="button"
                            onMouseDown={startRecording}
                            onMouseUp={stopRecording}
                            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                            className={`p-6 rounded-full cursor-pointer transition ${
                              isRecording ? "bg-rose-600 text-white animate-pulse" : "bg-indigo-650 hover:bg-indigo-600 text-white"
                            }`}
                          >
                            <Mic className="w-7 h-7" />
                          </button>
                        </div>

                        <div>
                          <p className="text-xs font-bold text-slate-300">
                            {isRecording ? "🔴 語音持續錄製中... 放開立刻上傳" : "長按麥克風進行高音質直連錄音"}
                          </p>
                          <span className="text-[10px] text-slate-500 mt-1 block">錄音將暫存為 wav / mp3 格式並綁定給審定區，核准後將自動呼叫 Gemini!</span>
                        </div>
                      </div>
                    ) : (
                      <textarea
                        required
                        value={submitContent}
                        onChange={(e) => setSubmitContent(e.target.value)}
                        placeholder={
                          submitType === "todo" ? "輸入追加的任務具體執行內容 (如: 修改 server.ts 的 cookie 宣告以符合 OAuth2 標準)." :
                          submitType === "mindmap" ? "輸入心智圖腦袋分支的展示標籤 (如: 軟硬隔離) " : "輸入補充的文字逐字稿、討論實錄或是修正細節..."
                        }
                        rows={5}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs text-white p-4 rounded-2xl outline-none"
                      />
                    )}
                  </div>

                  {/* Submit Button Trigger */}
                  {submitType !== "voice" && (
                    <button
                      type="submit"
                      disabled={clientSubmitting || !submitContent.trim()}
                      className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 transition font-bold py-3 text-xs text-white rounded-xl cursor-pointer disabled:cursor-not-allowed"
                    >
                      {clientSubmitting ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          正在連線提交提案至審核緩衝區...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          發起審核提案建言
                        </>
                      )}
                    </button>
                  )}

                </form>
              </div>
            )}

          </div>
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
