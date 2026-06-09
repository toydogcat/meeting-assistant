import React from "react";
import { ShieldAlert } from "lucide-react";

interface PasswordGateProps {
  isOpen: boolean;
  error: string;
  passwordInput: string;
  setPasswordInput: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const PasswordGate: React.FC<PasswordGateProps> = ({
  isOpen,
  error,
  passwordInput,
  setPasswordInput,
  onSubmit,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
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

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400 rounded-xl font-medium">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">請輸入會議房間密碼 (Room Password)</label>
            <input 
              type="password"
              required
              autoFocus
              placeholder="輸入對接密碼..."
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
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
              onClick={onCancel}
              className="px-6 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-semibold py-3 rounded-xl transition cursor-pointer"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
