import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { 
  Mic, Copy, Check, SquareTerminal, Calendar, Plus, Wifi, RefreshCw, Trash2, 
  Sparkles, Layers, CheckSquare, Square, FileUp, Play, FileText, Download, 
  X, Pencil, Save, PhoneCall 
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Role, RoomSession, TodoItem, MindmapNode } from "../types";
import { analyzeMeetingClientSide } from "../utils/gemini";
import { saveRoom } from "../utils/db";

interface HostDashboardProps {
  roomId: string;
  session: RoomSession | null;
  joinedDevices: any[];
  diagnosticsLog: string[];
  roomStoredPassword?: string;
  
  hostTab: "live" | "history" | "audit";
  setHostTab: (tab: "live" | "history" | "audit") => void;
  
  pendingAudits: any[];
  isLoadingMeetings: boolean;
  meetingsList: any[];
  
  selectedHistoryMeeting: RoomSession | null;
  setSelectedHistoryMeeting: React.Dispatch<React.SetStateAction<RoomSession | null>>;
  
  isLoadingAudits: boolean;
  geminiApiKey: string;
  selectedModel: string;
  isCoping: boolean;

  copyConnectLink: () => void;
  fetchMeetingsList: () => Promise<void>;
  fetchPendingAudits: () => Promise<void>;
  createNewHistoricalMeeting: (title: string) => Promise<void>;
  forceAnalyze: () => Promise<void>;
  clearSessionOnServer: () => Promise<void>;
  handleAudioFileUpload: (e: React.ChangeEvent<HTMLInputElement>, roomId: string, isHistory?: boolean) => Promise<void>;
  saveMeetingModification: (roomId: string, mod: Partial<RoomSession>) => Promise<void>;
  loadHistoryMeetingDetail: (roomId: string) => Promise<void>;
  handleTranscriptFileUpload: (e: React.ChangeEvent<HTMLInputElement>, roomId: string, isHistory?: boolean) => Promise<void>;
  handleAuditReview: (id: string, status: "approved" | "rejected") => Promise<void>;
  
  addLog: (log: string) => void;
}

export const HostDashboard: React.FC<HostDashboardProps> = ({
  roomId,
  session,
  joinedDevices,
  diagnosticsLog,
  roomStoredPassword,
  hostTab,
  setHostTab,
  pendingAudits,
  isLoadingMeetings,
  meetingsList,
  selectedHistoryMeeting,
  setSelectedHistoryMeeting,
  isLoadingAudits,
  geminiApiKey,
  selectedModel,
  isCoping,
  copyConnectLink,
  fetchMeetingsList,
  fetchPendingAudits,
  createNewHistoricalMeeting,
  forceAnalyze,
  clearSessionOnServer,
  handleAudioFileUpload,
  saveMeetingModification,
  loadHistoryMeetingDetail,
  handleTranscriptFileUpload,
  handleAuditReview,
  addLog,
}) => {
  // Local states for Host Dashboard
  const [isolatedNodeCodeTab, setIsolatedNodeCodeTab] = useState<"node" | "python">("node");
  const [clientBrowseSearch, setClientBrowseSearch] = useState("");
  
  // Edit states for history meeting
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [isEditingDate, setIsEditingDate] = useState(false);
  const [editDateVal, setEditDateVal] = useState("");
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [editSummaryVal, setEditSummaryVal] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll transcript on new segments
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.segments]);

  // Sync edit values when selected history meeting changes
  useEffect(() => {
    if (selectedHistoryMeeting) {
      setEditTitleVal(selectedHistoryMeeting.title || selectedHistoryMeeting.roomId);
      setEditDateVal(selectedHistoryMeeting.meetingDate || "");
      setEditSummaryVal(selectedHistoryMeeting.summary || "");
      setIsEditingTitle(false);
      setIsEditingDate(false);
      setIsEditingSummary(false);
    }
  }, [selectedHistoryMeeting]);

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

  return (
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
              {joinedDevices.map((device) => (
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
                  ? "bg-indigo-650/20 text-indigo-300 border border-indigo-500/20" 
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
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-rose-500/10 border border-slate-700 hover:border-rose-500/30 text-slate-450 hover:text-rose-300 text-xs px-4 py-2.5 rounded-full transition-colors"
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
                    <p className="text-[10px] text-slate-500 mt-1">隨著會議深入推進，討論要點將分支為 concept 概念網</p>
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
                  <p className="text-xs text-slate-505 py-10 text-center italic">無符合之歷史會期</p>
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
                        {(selectedHistoryMeeting.recordings || []).map((file) => (
                          <div key={file.id} className="flex items-center justify-between p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                            <div className="min-w-0 flex-1 pr-2">
                              <p className="text-xs font-semibold text-slate-200 truncate font-mono">{file.name}</p>
                              <span className="text-[9px] text-slate-505 font-mono block">
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
                          className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-850/10 text-white disabled:text-slate-500 text-xs font-bold py-3 rounded-xl transition duration-150 cursor-pointer disabled:cursor-not-allowed"
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
                      {selectedHistoryMeeting.segments?.map((seg) => (
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
                            className="bg-transparent border-none text-xs text-slate-105 w-full font-medium outline-none focus:bg-slate-950 px-1.5 py-0.5 rounded focus:border-indigo-500"
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
                      className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-855"
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
                  <div className="bg-slate-955/60 border border-slate-850 p-5 rounded-2xl flex flex-col text-left">
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
                      {selectedHistoryMeeting.todos?.map((todo) => (
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
                            <span className={`text-xs ml-1 ${todo.done ? "text-slate-505 line-through font-normal" : "text-slate-200 font-semibold"}`}>
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
                        className="bg-slate-955 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg flex-1 outline-none focus:border-indigo-500"
                      />
                      <input 
                        type="text" 
                        name="todo-assignee" 
                        placeholder="成員小王" 
                        className="bg-slate-955 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg w-24 outline-none focus:border-indigo-500"
                      />
                      <input 
                        type="text" 
                        name="todo-cat" 
                        placeholder="前端" 
                        className="bg-slate-955 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg w-20 outline-none focus:border-indigo-500"
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

                        const item = {
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
                        className="bg-slate-955 border border-slate-800 px-3 py-1.5 text-xs text-white rounded-lg flex-1 min-w-[150px] outline-none"
                      />
                      
                      <select name="parent-select" className="bg-slate-955 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 outline-none">
                        <option value="root">連結至核心主題</option>
                        {selectedHistoryMeeting.mindmap?.filter(n => n.id !== "root" && !n.parentId).map(n => (
                          <option key={n.id} value={n.id}>分支: {n.label}</option>
                        ))}
                      </select>

                      <select name="type-select" className="bg-slate-955 border border-slate-800 text-xs text-slate-300 rounded-lg px-2.5 py-1.5 outline-none">
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
                <div className="h-full flex flex-col items-center justify-center text-center p-12 text-slate-505 border border-dashed border-slate-800 rounded-2xl">
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
              <div className="py-20 text-center text-xs text-indigo-305 flex flex-col items-center gap-2 font-mono">
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
                      <span className="text-slate-505 font-semibold">
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
                        <span className="text-slate-205 font-bold">{sub.submittedBy}</span>
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
                        <div className="p-3 bg-slate-900/40 border border-slate-860 rounded-xl text-xs text-slate-105 font-medium whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
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
                        className="flex-1 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-505 hover:scale-102 font-extrabold text-xs text-white py-2.5 rounded-xl transition duration-150 cursor-pointer text-center"
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
  );
};
