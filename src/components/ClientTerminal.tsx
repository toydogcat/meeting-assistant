import React, { useState, useCallback } from "react";
import { 
  Mic, FileText, PlusCircle, PhoneCall, Send, Layers, Calendar, 
  Download, CheckSquare, Square, FileUp, RefreshCw, Check 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Role, RoomSession, MindmapNode, PendingSubmission } from "../types";
import { getRoom } from "../utils/db";

interface ClientTerminalProps {
  roomId: string;
  clientName: string;
  session: RoomSession | null;
  meetingsList: any[];
  fetchMeetingsList: () => Promise<void>;
  isRecording: boolean;
  voiceVolume: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  sendContentParcel: (text: string) => void;
  broadcastMessage: (msg: any) => void;
}

export const ClientTerminal: React.FC<ClientTerminalProps> = ({
  roomId,
  clientName,
  session,
  meetingsList,
  fetchMeetingsList,
  isRecording,
  voiceVolume,
  startRecording,
  stopRecording,
  sendContentParcel,
  broadcastMessage,
}) => {
  // Client tab navigation
  const [clientSection, setClientSection] = useState<"remote-speak" | "history-browse" | "propose-center">("remote-speak");

  // Input states
  const [inputText, setInputText] = useState("");
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [clientSubmitSuccessMsg, setClientSubmitSuccessMsg] = useState("");
  const [submitRoomId, setSubmitRoomId] = useState("");
  const [submitType, setSubmitType] = useState<"voice" | "todo" | "text" | "summary" | "mindmap">("text");
  const [submitContent, setSubmitContent] = useState("");
  const [submitSender, setSubmitSender] = useState("");

  // Custom proposals fields
  const [todoAssignee, setTodoAssignee] = useState("");
  const [todoCategory, setTodoCategory] = useState("智庫");
  const [mindmapParentId, setMindmapParentId] = useState("root");
  const [mindmapNodeType, setMindmapNodeType] = useState<"topic" | "detail" | "action">("detail");

  // Detail view for browsing history
  const [clientSelectedViewMeeting, setClientSelectedViewMeeting] = useState<RoomSession | null>(null);

  // Layout logic for mindmap rendering
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

  // Submit suggestion/proposal logic
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

      broadcastMessage({ type: "submit-proposal", submission: payload });
      setClientSubmitSuccessMsg("🎉 提案發起成功！主辦審核中心已獲取您的建議。待通過審核後會立即同步合併！");
      setSubmitContent("");
      setTodoAssignee("");
    } catch (err) {
      alert("發起提案時網路連線錯誤。");
    } finally {
      setClientSubmitting(false);
    }
  };

  return (
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
                      className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-855 hover:text-white border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
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
                      className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-855 hover:text-white border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-slate-300 transition-colors cursor-pointer"
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
                      <p className="text-[11px] text-slate-505 italic py-2">此主題下尚未指派任務待辦項目</p>
                    )}
                  </div>
                </div>

                {/* Mindmap canvas representation */}
                <div className="space-y-2 pb-2">
                  <h4 className="text-xs font-semibold text-white border-l-2 border-emerald-400 pl-2.5/2">
                    AI 語脈邏輯思考心智腦圖
                  </h4>
                  
                  <div className="border border-slate-950/80 bg-slate-950/30 rounded-xl overflow-hidden p-1.5 relative">
                    {clientSelectedViewMeeting.mindmap && clientSelectedViewMeeting.mindmap.length > 0 ? (
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
              <div className="h-full flex flex-col items-center justify-center text-center py-20 text-slate-550 border border-dashed border-slate-800 rounded-2xl">
                <FileUp className="w-12 h-12 stroke-1 text-slate-700 mb-2" />
                <p className="text-xs font-semibold text-slate-400">請由左方選擇一場歷史會議來調閱</p>
                <p className="text-[10px] text-slate-500 max-w-[200px] mt-1">您在此唯讀視窗中可流暢查閱所有摘要大綱、下載會議紀要，不具修改權限。</p>
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
                    submitType === "mindmap" ? "輸入心智圖腦袋分支的展示標籤 (如: 軟硬隔離) " : "輸入補充的文字逐字稿、討論實實討論實錄或是修正細節..."
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
  );
};
