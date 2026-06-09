from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import tempfile
from faster_whisper import WhisperModel
import ollama
from pydantic import BaseModel
from typing import List, Optional
import json

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Whisper model
# Using 'base' for a balance of speed and accuracy. 
# Options: 'tiny', 'base', 'small', 'medium', 'large-v3'
model_size = "base"
# device="cpu" or "cuda" (for NVIDIA GPU)
# compute_type="int8" or "float16" (float16 requires CUDA)
model = WhisperModel(model_size, device="cpu", compute_type="int8")

class TranscriptSegment(BaseModel):
    sender: str
    text: str

class AnalyzeRequest(BaseModel):
    transcripts: List[TranscriptSegment]

@app.post("/api/local/transcribe")
async def transcribe(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    try:
        # Save uploaded file to a temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        # Transcribe using faster-whisper
        segments, info = model.transcribe(tmp_path, beam_size=5, language=language)

        results = []
        full_text = ""
        for segment in segments:
            results.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text
            })
            full_text += segment.text + " "

        # Clean up temporary file
        os.remove(tmp_path)

        return {
            "text": full_text.strip(),
            "segments": results,
            "language": info.language,
            "language_probability": info.language_probability
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local/analyze")
async def analyze(request: AnalyzeRequest):
    try:
        # Format the transcripts for the prompt
        formatted_transcripts = "\n".join([f"{t.sender}: {t.text}" for t in request.transcripts])
        
        system_prompt = """你是一個專業的會議助理。請根據提供的會議逐字稿，整理出摘要、待辦事項與心智圖。
你必須只回應 JSON 格式，且符合以下結構：
{
  "summary": "Markdown 格式的摘要",
  "todos": [{"text": "工作內容", "assignee": "負責人", "category": "分類"}],
  "mindmap": [{"id": "root", "label": "核心"}, {"id": "1", "label": "子項", "parentId": "root", "type": "topic"}]
}
請使用繁體中文。"""
        
        user_prompt = f"以下是會議逐字稿：\n\n{formatted_transcripts}"

        response = ollama.chat(
            model='qwen2.5:7b', 
            messages=[
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
            format='json'
        )

        return json.loads(response['message']['content'])
    except Exception as e:
        # Fallback
        try:
            response = ollama.chat(
                model='qwen2.5:latest', 
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
                format='json'
            )
            return json.loads(response['message']['content'])
        except Exception as inner_e:
            raise HTTPException(status_code=500, detail=f"Ollama error: {str(e)} -> {str(inner_e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
