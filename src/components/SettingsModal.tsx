import React from "react";
import { Settings, X } from "lucide-react";
import { AiMode } from "../hooks/useSettings";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  geminiApiKey: string;
  setGeminiApiKey: (val: string) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  aiMode: AiMode;
  setAiMode: (mode: AiMode) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  geminiApiKey,
  setGeminiApiKey,
  selectedModel,
  setSelectedModel,
  aiMode,
  setAiMode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
        
        <div className="flex justify-between items-start mb-4">
          <div className="flex gap-3">
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl h-fit">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-md font-bold text-white tracking-tight">AI 引擎配置</h4>
              <p className="text-[10px] text-slate-400 mt-1">設定本地儲存的金鑰與模型</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">AI 處理模式 (Processing Mode)</label>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setAiMode("cloud")}
                className={`py-2 text-[11px] font-bold rounded-lg transition-all ${aiMode === "cloud" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"}`}
              >
                雲端 (Gemini)
              </button>
              <button
                type="button"
                onClick={() => setAiMode("local")}
                className={`py-2 text-[11px] font-bold rounded-lg transition-all ${aiMode === "local" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"}`}
              >
                本地 (Ollama/Whisper)
              </button>
            </div>
          </div>

          <div className={aiMode === "local" ? "opacity-40 grayscale pointer-events-none" : ""}>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Gemini API Key</label>
            <input 
              type="password"
              placeholder={aiMode === "local" ? "本地模式無需金鑰" : "輸入您的 Gemini API Key..."}
              disabled={aiMode === "local"}
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 text-white rounded-xl px-4 py-3 text-sm outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">預設 Generative Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
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
              onClick={onClose}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-3 rounded-xl transition cursor-pointer text-center"
            >
              確認並儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
