
"use strict";

const SOCKET_SERVER = "https://callspace-y55m.onrender.com";

const createButton = document.getElementById("createRoom");
const joinButton = document.getElementById("joinRoom");
const roomInput = document.getElementById("roomCode");

let socket = null;
let localStream = null;
let currentRoom = null;
let isLeaving = false;

const peers = new Map();
const remoteCards = new Map();
const pendingCandidates = new Map();

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function setStatus(message) {
  const status = document.getElementById("callStatus");
  if (status) status.textContent = message;
}

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function createRoom() {
  startCall(generateRoomCode());
}

function joinRoom() {
  const code = roomInput?.value.trim().toUpperCase();

  if (!code) {
    alert("Digite o código da sala!");
    roomInput?.focus();
    return;
  }

  if (!/^[A-Z0-9_-]{1,100}$/.test(code)) {
    alert("O código da sala contém caracteres inválidos.");
    return;
  }

  startCall(code);
}

if (createButton) {
  createButton.addEventListener("click", createRoom);
} else {
  console.error("CallSpace: botão createRoom não encontrado.");
}

if (joinButton) {
  joinButton.addEventListener("click", joinRoom);
} else {
  console.error("CallSpace: botão joinRoom não encontrado.");
}

function showCallScreen(code) {
  document.body.innerHTML = `
    <main style="
      min-height:100vh;background:#101522;color:#fff;
      padding:20px;box-sizing:border-box;
      font-family:Arial,sans-serif">
      <h1>CallSpace</h1>
      <p>Sala: <strong id="activeRoom"></strong></p>
      <button id="copyLink" type="button">Copiar link da sala</button>
      <p id="callStatus">Preparando chamada...</p>
      <section id="videos" style="
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
        gap:12px;margin-top:20px"></section>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:20px">
        <button id="micButton" type="button">Desligar microfone</button>
        <button id="cameraButton" type="button">Desligar câmera</button>
        <button id="leaveButton" type="button">Sair da sala</button>
      </div>
    </main>
  `;

  document.getElementById("activeRoom").textContent = code;

  document.getElementById("copyLink").onclick = async () => {
    const url = new URL(location.href);
    url.searchParams.set("room", code);

    try {
      await navigator.clipboard.writeText(url.href);
      alert("Link copiado!");
    } catch {
      prompt("Copie este link:", url.href);
    }
  };

  document.getElementById("micButton").onclick = () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    document.getElementById("micButton").textContent =
      track.enabled ? "Desligar microfone" : "Ligar microfone";
  };

  document.getElementById("cameraButton").onclick = () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    document.getElementById("cameraButton").textContent =
      track.enabled ? "Desligar câmera" : "Ligar câmera";
  };

  document.getElementById("leaveButton").onclick = leaveCall;
}

function addVideo(id, name, stream, muted = false) {
  const videos = document.getElementById("videos");
  if (!videos) return null;

  let card = id === "local" ? document.getElementById("video-local") : remoteCards.get(id);

  if (card) {
    const video = card.querySelector("video");
    if (video && video.srcObject !== stream) video.srcObject = stream;
    return card;
  }

  card = document.createElement("article");
  card.id = id === "local" ? "video-local" : `video-${id}`;
  card.style.cssText =
    "background:#20283a;padding:10px;border-radius:12px;min-width:0";

  const label = document.createElement("p");
  label.textContent = name;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.srcObject = stream;
  video.style.cssText =
    "width:100%;background:#05070b;border-radius:8px";

  card.append(label, video);
  videos.appendChild(card);

  if (id !== "local") remoteCards.set(id, card);
  video.play().catch(() => {});

  return card;
}

function removePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();

  peers.delete(peerId);
  pendingCandidates.delete(peerId);

  const card = remoteCards.get(peerId);
  if (card) card.remove();

  remoteCards.delete(peerId);
}

function sendToPeer(eventName, peerId, data) {
  if (!socket?.connected) return;

  socket.emit(eventName, {
    targetId: peerId,
    data
  });
}

function createPeer(peerId) {
  if (peers.has(peerId)) return peers.get(peerId);

  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, pc);
  pendingCandidates.set(peerId, []);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendToPeer("webrtc-ice-candidate", peerId, event.candidate);
    }
  };

  pc.ontrack = event => {
    let stream = event.streams[0];

    if (!stream) {
      stream = new MediaStream([event.track]);
    }

    const card = remoteCards.get(peerId);

    if (card) {
      const video = card.querySelector("video");

      if (video) {
        if (!video.srcObject || video.srcObject !== stream) {
          video.srcObject = stream;
        }

        if (!event.streams[0] && !video.srcObject.getTracks().includes(event.track)) {
          video.srcObject.addTrack(event.track);
        }
      }
    } else {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      addVideo(peerId, "Participante", remoteStream);
    }

    setStatus("Participante conectado!");
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      setStatus("Chamada conectada!");
    } else if (pc.connectionState === "failed") {
      setStatus("Falha na conexão. Tente novamente.");
    } else if (pc.connectionState === "disconnected") {
      setStatus("Conexão interrompida. Tentando recuperar...");
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
      console.error("Erro ao adicionar candidato ICE:", error);
    }
  }
}

function setupSocketEvents() {
  socket.on("connect", () => {
    if (currentRoom && !isLeaving) {
      socket.emit("join-room", currentRoom);
      setStatus("Conectado ao servidor. Entrando na sala...");
    }
  });

  socket.on("connect_error", error => {
    console.error("Erro de conexão:", error.message);
    setStatus("Não foi possível conectar ao servidor. Tente novamente.");
  });

  socket.on("room-users", async userIds => {
    for (const peerId of userIds) {
      try {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);

        sendToPeer("webrtc-offer", peerId, pc.localDescription);
      } catch (error) {
        console.error("Erro ao iniciar chamada:", error);
        setStatus("Erro ao iniciar a conexão com o participante.");
      }
    }

    if (!userIds.length) {
      setStatus("Sala criada! Aguardando outra pessoa...");
    }
  });

  socket.on("user-joined", () => {
    setStatus("Alguém entrou na sala. Conectando...");
  });

  socket.on("webrtc-offer", async ({ senderId, data }) => {
    try {
      const pc = createPeer(senderId);

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushCandidates(senderId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendToPeer("webrtc-answer", senderId, pc.localDescription);
    } catch (error) {
      console.error("Erro ao responder oferta:", error);
      setStatus("Erro ao negociar a chamada.");
    }
  });

  socket.on("webrtc-answer", async ({ senderId, data }) => {
    try {
      const pc = peers.get(senderId);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(data));
      await flushCandidates(senderId, pc);
    } catch (error) {
      console.error("Erro ao receber resposta:", error);
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
      console.error("Erro no candidato ICE:", error);
    }
  });

  socket.on("user-left", peerId => {
    removePeer(peerId);
    setStatus("Um participante saiu da sala.");
  });
}

async function startCall(code) {
  if (currentRoom) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Seu navegador não permite acesso à câmera. Abra o site por HTTPS em um navegador compatível.");
    return;
  }

  if (typeof io !== "function") {
    alert("O Socket.IO não carregou. Confira sua conexão com a internet e atualize a página.");
    return;
  }

  currentRoom = code;
  isLeaving = false;

  if (createButton) createButton.disabled = true;
  if (joinButton) joinButton.disabled = true;

  showCallScreen(code);
  setStatus("Solicitando acesso à câmera e ao microfone...");

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    addVideo("local", "Você", localStream, true);
    setStatus("Câmera ativa. Conectando ao servidor...");

    socket = io(SOCKET_SERVER, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    setupSocketEvents();

    if (socket.connected) {
      socket.emit("join-room", currentRoom);
    }
  } catch (error) {
    console.error("Erro ao iniciar CallSpace:", error);

    setStatus("Não foi possível iniciar: " + error.message);

    alert(
      "Não foi possível iniciar a chamada.\n\n" +
      error.message +
      "\n\nConfira as permissões da câmera e do microfone."
    );
  }
}

function leaveCall() {
  isLeaving = true;

  if (socket && currentRoom) {
    socket.emit("leave-room", currentRoom);
    socket.disconnect();
  }

  for (const peerId of peers.keys()) {
    removePeer(peerId);
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  const url = new URL(location.href);
  url.searchParams.delete("room");
  location.href = url.href;
}

const roomFromLink = new URLSearchParams(location.search).get("room");

if (roomFromLink && roomInput) {
  roomInput.value = roomFromLink.toUpperCase();
}
