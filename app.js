
"use strict";

const SERVER_URL = "https://callspace-y55m.onrender.com";

const $ = id => document.getElementById(id);

const home = $("home");
const callScreen = $("callScreen");
const nameInput = $("displayName");
const createButton = $("createRoom");
const joinButton = $("joinRoom");
const roomInput = $("roomCode");
const joinPanel = $("joinPanel");
const confirmJoin = $("confirmJoin");

let socket = null;
let localStream = null;
let currentRoom = null;
let displayName = "Participante";
let joined = false;
let leaving = false;

const peers = new Map();
const remoteCards = new Map();
const remoteNames = new Map();
const pendingCandidates = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function setHomeStatus(message) {
  const element = $("homeStatus");
  if (element) element.textContent = message;
}

function setCallStatus(message) {
  const element = $("callStatus");
  if (element) element.textContent = message;
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function showHome() {
  home.hidden = false;
  callScreen.hidden = true;
}

function showCall() {
  home.hidden = true;
  callScreen.hidden = false;
  $("activeRoom").textContent = currentRoom;
}

function getName() {
  const name = nameInput.value.trim();

  if (!name) {
    setHomeStatus("Digite seu nome antes de continuar.");
    nameInput.focus();
    return null;
  }

  return name.slice(0, 30);
}

function createRoom() {
  if (currentRoom) return;

  const name = getName();
  if (!name) return;

  displayName = name;
  currentRoom = makeRoomCode();

  $("roomCodeDisplay").textContent = currentRoom;
  $("createdRoom").hidden = false;
  roomInput.value = currentRoom;

  beginCall();
}

function openJoinPanel() {
  joinPanel.hidden = !joinPanel.hidden;

  if (!joinPanel.hidden) {
    roomInput.focus();
  }
}

function joinRoom() {
  if (currentRoom) return;

  const name = getName();
  if (!name) return;

  const code = roomInput.value.trim().toUpperCase();

  if (!code) {
    setHomeStatus("Digite o código da sala.");
    roomInput.focus();
    return;
  }

  if (!/^[A-Z0-9_-]{1,100}$/.test(code)) {
    setHomeStatus("Esse código contém caracteres inválidos.");
    return;
  }

  displayName = name;
  currentRoom = code;
  beginCall();
}

createButton.addEventListener("click", createRoom);
joinButton.addEventListener("click", openJoinPanel);
confirmJoin.addEventListener("click", joinRoom);

roomInput.addEventListener("keydown", event => {
  if (event.key === "Enter") joinRoom();
});

nameInput.addEventListener("input", () => {
  if (nameInput.value.length > 30) {
    nameInput.value = nameInput.value.slice(0, 30);
  }
});

$("copyCode").addEventListener("click", async () => {
  if (!currentRoom) return;

  const link = new URL(location.href);
  link.searchParams.set("room", currentRoom);

  try {
    await navigator.clipboard.writeText(link.href);
    $("copyCode").textContent = "Copiado!";
    setTimeout(() => {
      if ($("copyCode")) $("copyCode").textContent = "Copiar";
    }, 1800);
  } catch {
    prompt("Copie o link da sala:", link.href);
  }
});

function addVideo(id, name, stream, isLocal = false) {
  const container = $("videos");
  if (!container) return;

  const existing = isLocal ? $("video-local") : remoteCards.get(id);

  if (existing) {
    const video = existing.querySelector("video");
    if (video && video.srcObject !== stream) video.srcObject = stream;
    const label = existing.querySelector(".video-name");
    if (label) label.textContent = name;
    return existing;
  }

  const card = document.createElement("article");
  card.className = "video-card";
  card.id = isLocal ? "video-local" : `video-${id}`;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;
  video.srcObject = stream;

  const label = document.createElement("p");
  label.className = "video-name";
  label.textContent = name;

  card.append(video, label);
  container.appendChild(card);

  video.play().catch(() => {});

  if (!isLocal) remoteCards.set(id, card);
  return card;
}

function updateRemoteName(id, name) {
  remoteNames.set(id, name || "Participante");

  const card = remoteCards.get(id);
  const label = card?.querySelector(".video-name");

  if (label) label.textContent = remoteNames.get(id);
}

function emitToPeer(eventName, targetId, data) {
  if (!socket?.connected) return;

  socket.emit(eventName, {
    targetId,
    data
  });
}

function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, pc);
  pendingCandidates.set(peerId, []);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      emitToPeer("webrtc-ice-candidate", peerId, event.candidate);
    }
  };

  pc.ontrack = event => {
    let stream = event.streams[0];

    if (!stream) {
      stream = new MediaStream([event.track]);
    }

    addVideo(
      peerId,
      remoteNames.get(peerId) || "Participante",
      stream
    );

    setCallStatus("Chamada conectada!");
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setCallStatus("Chamada conectada!");
    } else if (pc.connectionState === "failed") {
      setCallStatus("Falha na conexão. Tente novamente.");
    } else if (pc.connectionState === "disconnected") {
      setCallStatus("Conexão interrompida.");
    }
  };

  return pc;
}

async function flushCandidates(peerId, pc) {
  const candidates = pendingCandidates.get(peerId) || [];
  pendingCandidates.set(peerId, []);

  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Erro ao adicionar ICE:", error);
    }
  }
}

function setupSocket() {
  socket = io(SERVER_URL, {
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 20000
  });

  socket.on("connect", () => {
    if (leaving || !currentRoom || joined) return;

    socket.emit("join-room", {
      roomId: currentRoom,
      displayName
    });
  });

  socket.on("connect_error", error => {
    console.error("Socket.IO:", error.message);
    setCallStatus("Não foi possível conectar ao servidor. Tentando novamente...");
  });

  socket.on("room-joined", result => {
    joined = true;
    setCallStatus(
      result?.message || "Sala conectada. Aguardando participantes..."
    );
  });

  socket.on("room-error", message => {
    setCallStatus(message || "Não foi possível entrar na sala.");
  });

  socket.on("room-users", async users => {
    for (const user of users) {
      const peerId = typeof user === "string" ? user : user.id;
      if (!peerId || peerId === socket.id) continue;

      if (user.displayName) {
        updateRemoteName(peerId, user.displayName);
      }

      try {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);
        emitToPeer("webrtc-offer", peerId, pc.localDescription);
      } catch (error) {
        console.error("Erro ao iniciar conexão:", error);
      }
    }
  });

  socket.on("user-joined", user => {
    const peerId = typeof user === "string" ? user : user.id;
    if (!peerId || peerId === socket.id) return;

    if (user.displayName) {
      updateRemoteName(peerId, user.displayName);
    }

    setCallStatus(`${user.displayName || "Um participante"} entrou na sala.`);
  });

  socket.on("webrtc-offer", async ({ senderId, senderName, data }) => {
    try {
      if (senderName) updateRemoteName(senderId, senderName);

      const pc = createPeer(senderId);
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushCandidates(senderId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      emitToPeer("webrtc-answer", senderId, pc.localDescription);
    } catch (error) {
      console.error("Erro ao responder chamada:", error);
      setCallStatus("Erro ao estabelecer a chamada.");
    }
  });

  socket.on("webrtc-answer", async ({ senderId, senderName, data }) => {
    try {
      if (senderName) updateRemoteName(senderId, senderName);

      const pc = peers.get(senderId);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushCandidates(senderId, pc);
    } catch (error) {
      console.error("Erro na resposta WebRTC:", error);
    }
  });

  socket.on("webrtc-ice-candidate", async ({ senderId, data }) => {
    try {
      const pc = peers.get(senderId);

      if (!pc || !pc.remoteDescription) {
        if (!pendingCandidates.has(senderId)) {
          pendingCandidates.set(senderId, []);
        }

        pendingCandidates.get(senderId).push(data);
        return;
      }

      await pc.addIceCandidate(new RTCIceCandidate(data));
    } catch (error) {
      console.error("Erro ICE:", error);
    }
  });

  socket.on("user-left", user => {
    const peerId = typeof user === "string" ? user : user.id;
    if (!peerId) return;

    removePeer(peerId);
    setCallStatus(`${user.displayName || "Um participante"} saiu da sala.`);
  });

  socket.on("disconnect", () => {
    if (!leaving) setCallStatus("Conexão com o servidor perdida. Reconectando...");
    joined = false;
  });
}

async function beginCall() {
  leaving = false;
  joined = false;

  showCall();
  setCallStatus("Solicitando câmera e microfone...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite acesso à câmera. Use HTTPS.");
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    addVideo("local", displayName, localStream, true);

    $("micButton").onclick = toggleMicrophone;
    $("cameraButton").onclick = toggleCamera;
    $("leaveButton").onclick = leaveCall;

    if (typeof io !== "function") {
      throw new Error("O Socket.IO não carregou. Atualize a página.");
    }

    setCallStatus("Conectando ao servidor...");
    setupSocket();
  } catch (error) {
    console.error(error);
    setCallStatus(error.message);
  }
}

function toggleMicrophone() {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  $("micButton").classList.toggle("off", !track.enabled);
  $("micLabel").textContent = track.enabled ? "Microfone" : "Mic desligado";
}

function toggleCamera() {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;

  track.enabled = !track.enabled;
  $("cameraButton").classList.toggle("off", !track.enabled);
  $("cameraLabel").textContent = track.enabled ? "Câmera" : "Câmera desligada";
}

function removePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();

  peers.delete(peerId);
  pendingCandidates.delete(peerId);

  const card = remoteCards.get(peerId);
  if (card) card.remove();

  remoteCards.delete(peerId);
  remoteNames.delete(peerId);
}

function leaveCall() {
  leaving = true;

  if (socket) {
    if (socket.connected && currentRoom) {
      socket.emit("leave-room", currentRoom);
    }
    socket.disconnect();
    socket = null;
  }

  for (const peerId of [...peers.keys()]) {
    removePeer(peerId);
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  currentRoom = null;
  joined = false;

  location.href = location.pathname;
}

const roomFromLink = new URLSearchParams(location.search).get("room");

if (roomFromLink) {
  roomInput.value = roomFromLink.toUpperCase();
  joinPanel.hidden = false;
}

showHome();
