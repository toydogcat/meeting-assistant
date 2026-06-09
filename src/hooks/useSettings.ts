import { useState, useEffect } from "react";

export type AiMode = "cloud" | "local";

export function useSettings() {
  const [geminiApiKey, setGeminiApiKey] = useState(() => 
    localStorage.getItem("meeting_assistant_gemini_api_key") || ""
  );
  
  const [selectedModel, setSelectedModel] = useState(() => 
    localStorage.getItem("meeting_assistant_selected_model") || "gemini-2.5-flash"
  );
  
  const [aiMode, setAiMode] = useState<AiMode>(() => 
    (localStorage.getItem("meeting_assistant_ai_mode") as AiMode) || "cloud"
  );

  // Persistence effects
  useEffect(() => {
    localStorage.setItem("meeting_assistant_gemini_api_key", geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem("meeting_assistant_selected_model", selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    localStorage.setItem("meeting_assistant_ai_mode", aiMode);
  }, [aiMode]);

  return {
    geminiApiKey,
    setGeminiApiKey,
    selectedModel,
    setSelectedModel,
    aiMode,
    setAiMode,
  };
}
