/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Role = "none" | "host" | "client" | "cohost";

export interface MeetingSegment {
  id: string;
  timestamp: number;
  sender: string;
  text: string;
  isVoice: boolean;
}

export interface TodoItem {
  id: string;
  text: string;
  assignee: string;
  done: boolean;
  category: string;
}

export interface MindmapNode {
  id: string;
  label: string;
  parentId?: string;
  type?: "topic" | "detail" | "action";
}

export interface MeetingRecording {
  id: string;
  name: string;
  timestamp: number;
  size?: number; // bytes
  base64Data?: string; // stored base64 or representation
}

export interface RoomSession {
  roomId: string;
  title?: string; // Meeting custom title
  meetingDate?: string; // Meeting custom date, format: YYYY-MM-DD
  createdTime: number;
  status: "active" | "recording" | "analyzing" | "completed";
  segments: MeetingSegment[];
  summary: string;
  todos: TodoItem[];
  mindmap: MindmapNode[];
  recordings?: MeetingRecording[]; // Uploaded audio files
  password?: string; // Room access password if configured
  passwordProtected?: boolean; // Mirror state for UI
}

export interface PendingSubmission {
  id: string;
  roomId: string; // Target meeting ID
  meetingTitle?: string; // Cached title
  type: "voice" | "todo" | "text" | "summary" | "mindmap"; // Part of meeting
  content: string; // The raw content (transcribed text, draft TODO text, summary fragment, node label, or base64 raw voice)
  submittedBy: string; // Sender identity
  status: "pending" | "approved" | "rejected";
  timestamp: number;
  additionalInfo?: {
    category?: string; // for TODO items
    assignee?: string; // for TODO items
    parentId?: string; // for mindmap nodes
    nodeType?: "topic" | "detail" | "action"; // for mindmap nodes
    voiceMime?: string; // for base64 sound
    originalName?: string; // for files
  };
}

export type WebRTCMessage = 
  | { type: "offer"; sdp: RTCSessionDescriptionInit; sender: string }
  | { type: "answer"; sdp: RTCSessionDescriptionInit; sender: string }
  | { type: "candidate"; candidate: RTCIceCandidateInit; sender: string }
  | { type: "client-joined"; roomId: string; clientId: string }
  | { type: "client-left"; clientId: string }
  | { type: "error"; message: string }
  | { type: "sync"; session: RoomSession }
  | { type: "new-segment"; segment: MeetingSegment }
  | { type: "ping" };
