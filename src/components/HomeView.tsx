import React from "react";
import { Cpu, Mic, AlertCircle } from "lucide-react";
import { Role } from "../types";

interface HomeViewProps {
  roomId: string;
  setRoomId: (id: string) => void;
  clientRoleChoice: "client" | "cohost";
  setClientRoleChoice: (choice: "client" | "cohost") => void;
  showHostSetupForm: boolean;
  setShowHostSetupForm: (show: boolean) => void;
  setupTitle: string;
  setSetupTitle: (val: string) => void;
  setupDate: string;
  setSetupDate: (val: string) => void;
  setupRoomId: string;
  setSetupRoomId: (val: string) => void;
  setupUsePassword: boolean;
  setSetupUsePassword: (val: boolean) => void;
  setupPassword: string;
  setSetupPassword: (val: string) => void;
  creatingMeeting: boolean;
  handleCreateHostRoom: (e: React.FormEvent) => void;
  handleManualClientConnect: (e: React.FormEvent) => void;
  handleRoleSelection: (role: Role) => void;
  apiHealth: { keyConfigured: boolean; alive: boolean };
}

export const HomeView: React.FC<HomeViewProps> = ({
  roomId,
  setRoomId,
  clientRoleChoice,
  setClientRoleChoice,
  showHostSetupForm,
  setShowHostSetupForm,
  setupTitle,
  setSetupTitle,
  setupDate,
  setSetupDate,
  setupRoomId,
  setSetupRoomId,
  setupUsePassword,
  setSetupUsePassword,
  setupPassword,
  setSetupPassword,
  creatingMeeting,
  handleCreateHostRoom,
  handleManualClientConnect,
  handleRoleSelection,
  apiHealth,
}) => {
  return (
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
  );
};
