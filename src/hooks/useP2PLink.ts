/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import mqtt, { MqttClient } from "mqtt";
import { Role, RoomSession } from "../types";

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_PREFIX = "luna/meeting-assistant";

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

export interface P2PMessage {
  type: string;
  [key: string]: any;
}

export function useP2PLink(
  roomId: string,
  role: Role,
  myId: string,
  myName: string,
  password?: string,
  onMessageReceived?: (fromId: string, message: P2PMessage) => void,
  onPeerConnected?: (clientId: string) => void,
  onPeerDisconnected?: (clientId: string) => void,
  onAuthFailed?: (reason: string) => void,
  addLog?: (msg: string) => void
) {
  const [status, setStatus] = useState<"offline" | "connecting" | "online">("offline");
  const [webrtcConnected, setWebrtcConnected] = useState(false);
  const [joinedDevices, setJoinedDevices] = useState<{ id: string }[]>([]);

  const mqttClientRef = useRef<MqttClient | null>(null);
  
  // Host state: Map of client ID -> RTCPeerConnection
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Host state: Map of client ID -> RTCDataChannel
  const channelsRef = useRef<Map<string, RTCDataChannel>>(new Map());

  // Client state: single peer connection & data channel to Host
  const clientPcRef = useRef<RTCPeerConnection | null>(null);
  const clientChannelRef = useRef<RTCDataChannel | null>(null);
  const hostIdRef = useRef<string | null>(null);

  const log = useCallback((msg: string) => {
    if (addLog) {
      addLog(`[P2P Link] ${msg}`);
    } else {
      console.log(`[P2P Link] ${msg}`);
    }
  }, [addLog]);

  // Cleanup helper
  const cleanupPeer = useCallback((id: string) => {
    log(`Cleaning up connection for ${id.slice(0, 5)}`);
    const pc = pcsRef.current.get(id);
    if (pc) {
      pc.close();
      pcsRef.current.delete(id);
    }
    const ch = channelsRef.current.get(id);
    if (ch) {
      ch.close();
      channelsRef.current.delete(id);
    }
    setJoinedDevices(prev => prev.filter(d => d.id !== id));
    if (onPeerDisconnected) onPeerDisconnected(id);

    if (channelsRef.current.size === 0) {
      setWebrtcConnected(false);
    }
  }, [log, onPeerDisconnected]);

  // Clean up all connections
  const disconnectAll = useCallback(() => {
    log("Disconnecting all P2P and MQTT connections...");
    if (mqttClientRef.current) {
      mqttClientRef.current.end(true);
      mqttClientRef.current = null;
    }

    pcsRef.current.forEach(pc => pc.close());
    pcsRef.current.clear();
    channelsRef.current.forEach(ch => ch.close());
    channelsRef.current.clear();

    if (clientPcRef.current) {
      clientPcRef.current.close();
      clientPcRef.current = null;
    }
    if (clientChannelRef.current) {
      clientChannelRef.current.close();
      clientChannelRef.current = null;
    }

    setJoinedDevices([]);
    setWebrtcConnected(false);
    setStatus("offline");
  }, [log]);

  // Send message via P2P (or fallback to MQTT if not fully established)
  const sendMessage = useCallback((toId: string, message: P2PMessage) => {
    // If we have an active WebRTC DataChannel to this recipient, send it P2P
    const channel = role === "host" ? channelsRef.current.get(toId) : clientChannelRef.current;
    if (channel && channel.readyState === "open") {
      try {
        channel.send(JSON.stringify(message));
        return;
      } catch (err) {
        log(`Failed to send WebRTC message: ${err}`);
      }
    }

    // Fallback: send via MQTT signaling topic
    if (mqttClientRef.current && mqttClientRef.current.connected) {
      const payload = {
        type: "direct-message",
        from: myId,
        message
      };
      mqttClientRef.current.publish(
        `${TOPIC_PREFIX}/${roomId}/signal/${toId}`,
        JSON.stringify(payload)
      );
    } else {
      log(`Warning: Cannot send message to ${toId.slice(0, 5)}, no connection channels open.`);
    }
  }, [role, myId, roomId, log]);

  // Broadcast message to all joined peers
  const broadcastMessage = useCallback((message: P2PMessage) => {
    if (role === "host") {
      // Host broadcasts to all clients
      channelsRef.current.forEach((channel, clientId) => {
        if (channel.readyState === "open") {
          try {
            channel.send(JSON.stringify(message));
          } catch (err) {
            log(`Failed to broadcast WebRTC message to ${clientId.slice(0, 5)}: ${err}`);
          }
        } else {
          // Fallback via MQTT
          sendMessage(clientId, message);
        }
      });

      // Also publish via MQTT lobby_sync for any connecting guest
      if (mqttClientRef.current && mqttClientRef.current.connected) {
        mqttClientRef.current.publish(
          `${TOPIC_PREFIX}/${roomId}/lobby_sync`,
          JSON.stringify({ from: myId, type: "lobby_broadcast", message })
        );
      }
    } else {
      // Guest sends directly to host
      if (hostIdRef.current) {
        sendMessage(hostIdRef.current, message);
      } else {
        log("Cannot broadcast: no host detected yet.");
      }
    }
  }, [role, myId, roomId, sendMessage, log]);

  // Setup Peer Connection for Host
  const initiateHostWebRTC = useCallback(async (targetClientId: string) => {
    log(`[Host] Initializing WebRTC connection to client ${targetClientId.slice(0, 5)}`);
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcsRef.current.set(targetClientId, pc);

      const dc = pc.createDataChannel("meeting-datachannel", { ordered: true });
      channelsRef.current.set(targetClientId, dc);

      dc.onopen = () => {
        log(`[Host] DataChannel opened with client ${targetClientId.slice(0, 5)}!`);
        setWebrtcConnected(true);
        if (onPeerConnected) onPeerConnected(targetClientId);
      };

      dc.onclose = () => {
        log(`[Host] DataChannel closed with client ${targetClientId.slice(0, 5)}`);
        cleanupPeer(targetClientId);
      };

      dc.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as P2PMessage;
          if (onMessageReceived) {
            onMessageReceived(targetClientId, parsed);
          }
        } catch (err) {
          log(`[Host] Error parsing WebRTC message from ${targetClientId.slice(0, 5)}: ${err}`);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && mqttClientRef.current) {
          const signalMsg = {
            type: "candidate",
            from: myId,
            candidate: event.candidate
          };
          mqttClientRef.current.publish(
            `${TOPIC_PREFIX}/${roomId}/signal/${targetClientId}`,
            JSON.stringify(signalMsg)
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        log(`[Host] ICE State with ${targetClientId.slice(0, 5)} changed to ${pc.iceConnectionState}`);
        if (["disconnected", "failed", "closed"].includes(pc.iceConnectionState)) {
          cleanupPeer(targetClientId);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (mqttClientRef.current) {
        const offerMsg = {
          type: "offer",
          from: myId,
          sdp: offer
        };
        mqttClientRef.current.publish(
          `${TOPIC_PREFIX}/${roomId}/signal/${targetClientId}`,
          JSON.stringify(offerMsg)
        );
        log(`[Host] Published SDP Offer to client ${targetClientId.slice(0, 5)}`);
      }
    } catch (err) {
      log(`[Host] Error initiating WebRTC: ${err}`);
    }
  }, [myId, roomId, onMessageReceived, onPeerConnected, cleanupPeer, log]);

  // Setup Peer Connection for Guest/Client
  const respondClientWebRTC = useCallback(async (hostId: string, remoteOffer: RTCSessionDescriptionInit) => {
    log(`[Client] Initializing WebRTC in response to Host ${hostId.slice(0, 5)}`);
    try {
      if (clientPcRef.current) {
        clientPcRef.current.close();
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      clientPcRef.current = pc;
      hostIdRef.current = hostId;

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        clientChannelRef.current = dc;

        dc.onopen = () => {
          log("[Client] DataChannel successfully established with Host!");
          setWebrtcConnected(true);
          if (onPeerConnected) onPeerConnected(hostId);
          
          // Disconnect Guest from MQTT after 5 seconds of stable WebRTC to save resources
          setTimeout(() => {
            if (clientChannelRef.current && clientChannelRef.current.readyState === "open" && mqttClientRef.current) {
              log("[Client] Connection stable. Disconnecting from MQTT signaling server to conserve bandwidth.");
              mqttClientRef.current.end();
              mqttClientRef.current = null;
              setStatus("online"); // keep online status based on WebRTC
            }
          }, 5000);
        };

        dc.onclose = () => {
          log("[Client] DataChannel with Host closed");
          setWebrtcConnected(false);
          if (onPeerDisconnected) onPeerDisconnected(hostId);
        };

        dc.onmessage = (e) => {
          try {
            const parsed = JSON.parse(e.data) as P2PMessage;
            if (onMessageReceived) {
              onMessageReceived(hostId, parsed);
            }
          } catch (err) {
            log(`[Client] Error parsing message from Host: ${err}`);
          }
        };
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && mqttClientRef.current) {
          const signalMsg = {
            type: "candidate",
            from: myId,
            candidate: event.candidate
          };
          mqttClientRef.current.publish(
            `${TOPIC_PREFIX}/${roomId}/signal/${hostId}`,
            JSON.stringify(signalMsg)
          );
        }
      };

      pc.oniceconnectionstatechange = () => {
        log(`[Client] ICE State with Host changed to ${pc.iceConnectionState}`);
        if (["disconnected", "failed", "closed"].includes(pc.iceConnectionState)) {
          setWebrtcConnected(false);
          if (onPeerDisconnected) onPeerDisconnected(hostId);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (mqttClientRef.current) {
        const answerMsg = {
          type: "answer",
          from: myId,
          sdp: answer
        };
        mqttClientRef.current.publish(
          `${TOPIC_PREFIX}/${roomId}/signal/${hostId}`,
          JSON.stringify(answerMsg)
        );
        log(`[Client] Published SDP Answer to Host ${hostId.slice(0, 5)}`);
      }
    } catch (err) {
      log(`[Client] Error responding to WebRTC offer: ${err}`);
    }
  }, [myId, roomId, onMessageReceived, onPeerConnected, onPeerDisconnected, log]);

  // Main connection effect
  useEffect(() => {
    if (!roomId || role === "none") return;

    setStatus("connecting");
    log(`Connecting to MQTT signaling server... (Broker: ${BROKER_URL}, Room: ${roomId})`);

    const mqttClient = mqtt.connect(BROKER_URL, {
      clientId: `ma_${role}_${myId}_${Math.random().toString(16).substring(2, 6)}`,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });

    mqttClientRef.current = mqttClient;

    mqttClient.on("connect", () => {
      log("Successfully connected to signaling server.");
      setStatus("online");

      // Subscribe to topics according to Role
      if (role === "host") {
        mqttClient.subscribe(`${TOPIC_PREFIX}/${roomId}/join`);
        mqttClient.subscribe(`${TOPIC_PREFIX}/${roomId}/signal/${myId}`);
        log(`[Host] Subscribed to Room ${roomId} join and signal topics.`);
      } else {
        // Guest/Client/Cohost
        mqttClient.subscribe(`${TOPIC_PREFIX}/${roomId}/lobby_sync`);
        mqttClient.subscribe(`${TOPIC_PREFIX}/${roomId}/signal/${myId}`);
        log(`[Guest] Subscribed to Room ${roomId} lobby and signal topics.`);

        // Publish Join announcement
        const joinMsg = {
          type: "join",
          id: myId,
          name: myName,
          role: role,
          password: password || ""
        };
        mqttClient.publish(`${TOPIC_PREFIX}/${roomId}/join`, JSON.stringify(joinMsg));
        log(`[Guest] Published Join Request to Host.`);
      }
    });

    mqttClient.on("message", async (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());

        // Host receives a Join Request
        if (topic === `${TOPIC_PREFIX}/${roomId}/join`) {
          if (data.type === "join" && role === "host" && data.id !== myId) {
            log(`[Host] Received Join Request from client ${data.name} (${data.id.slice(0, 5)})`);
            
            // Password verification
            // Let the App handle actual validation or do it directly here
            if (password && password !== data.password) {
              log(`[Host] Password invalid for client ${data.name}. Rejecting.`);
              const errorMsg = {
                type: "auth_error",
                from: myId,
                reason: "PASSWORD_INVALID"
              };
              mqttClient.publish(
                `${TOPIC_PREFIX}/${roomId}/signal/${data.id}`,
                JSON.stringify(errorMsg)
              );
              return;
            }

            // Valid client! Update joined devices
            setJoinedDevices(prev => {
              if (prev.some(d => d.id === data.id)) return prev;
              return [...prev, { id: data.id }];
            });

            // Start WebRTC process
            initiateHostWebRTC(data.id);
          }
        }

        // Host/Client receives signaling messages
        if (topic === `${TOPIC_PREFIX}/${roomId}/signal/${myId}`) {
          if (data.type === "offer" && (role === "client" || role === "cohost")) {
            log(`[Client] Received SDP Offer from Host ${data.from.slice(0, 5)}`);
            respondClientWebRTC(data.from, data.sdp);
          } else if (data.type === "answer" && role === "host") {
            log(`[Host] Received SDP Answer from client ${data.from.slice(0, 5)}`);
            const pc = pcsRef.current.get(data.from);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            }
          } else if (data.type === "candidate") {
            log(`Received ICE candidate from ${data.from.slice(0, 5)}`);
            const pc = role === "host" ? pcsRef.current.get(data.from) : clientPcRef.current;
            if (pc) {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          } else if (data.type === "auth_error" && (role === "client" || role === "cohost")) {
            log(`[Client] Authentication error: ${data.reason}`);
            if (onAuthFailed) onAuthFailed(data.reason);
            disconnectAll();
          } else if (data.type === "direct-message") {
            // Direct JSON messaging fallback over MQTT
            if (onMessageReceived) {
              onMessageReceived(data.from, data.message);
            }
          }
        }

        // Guest receives a Lobby Broadcast / Sync
        if (topic === `${TOPIC_PREFIX}/${roomId}/lobby_sync` && (role === "client" || role === "cohost")) {
          if (data.type === "lobby_broadcast") {
            if (onMessageReceived) {
              onMessageReceived(data.from, data.message);
            }
          }
        }

      } catch (err) {
        log(`Error processing signaling message: ${err}`);
      }
    });

    mqttClient.on("error", (err) => {
      log(`MQTT connection error: ${err}`);
      setStatus("offline");
    });

    mqttClient.on("close", () => {
      log("MQTT connection closed.");
    });

    return () => {
      // Do not clean up connections here unless the role or roomId actually changes.
      // But React cleanup runs on dependency changes, which is correct.
      disconnectAll();
    };
  }, [roomId, role, myId, myName, password, initiateHostWebRTC, respondClientWebRTC, onMessageReceived, onAuthFailed, disconnectAll, log]);

  return {
    status,
    webrtcConnected,
    joinedDevices,
    broadcastMessage,
    sendMessage,
    disconnectAll
  };
}
