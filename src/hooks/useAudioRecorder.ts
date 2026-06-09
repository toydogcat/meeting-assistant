import { useState, useRef, useCallback, useEffect } from "react";

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }
    
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    audioAnalyserRef.current = null;
    setIsRecording(false);
    setVoiceVolume(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const startRecording = useCallback(async (onDataAvailable: (blob: Blob) => void) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Setup Visualizer
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      
      audioContextRef.current = audioCtx;
      audioAnalyserRef.current = analyser;
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const average = sum / dataArray.length;
        setVoiceVolume(average);
        rafRef.current = requestAnimationFrame(updateVolume);
      };
      updateVolume();
      
      // Setup Recorder
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") 
        ? "audio/webm;codecs=opus" 
        : "audio/ogg;codecs=opus";
        
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          onDataAvailable(e.data);
        }
      };
      
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      
      return mimeType;
    } catch (err) {
      console.error("Failed to start recording", err);
      cleanup();
      throw err;
    }
  }, [cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      // Stop all tracks to turn off the microphone light
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    cleanup();
  }, [cleanup]);

  return {
    isRecording,
    voiceVolume,
    startRecording,
    stopRecording,
    mediaRecorderRef
  };
}
