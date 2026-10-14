
const SOCKET_SERVER = "https://callspace-y55m.onrender.com";

const socket = io(SOCKET_SERVER);

let localStream = null;
let currentRoom = null;
let peers = {};
let pendingCandidates = {};

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

const createButton = document.getElementById("createRoom");
const joinButton = document.getElementById("joinRoom");
const roomInput = document.getElementById("roomCode");

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom() {
  const code = generateRoomCode();
  startCall(code);
}

function joinRoom() {
  const code = roomInput.value.trim().toUpperCase();

  if (!code) {
    alert("Digite o código da sala!");
    return;
  }

  startCall(code);
}

if (createButton) {
  createButton.addEventListener("click", createRoom);
}

if (joinButton) {
  joinButton.addEventListener("click", joinRoom);
}

async function startCall(code) {
  if (currentRoom) return;

  currentRoom = code;

  document.body.innerHTML = `
    <main style="background:#101522;color:white;min-height:100vh;
    padding:20px;box-sizing:border-box;font-family:Arial,sans-serif;">
      <h2>CallSpace</h2>
      <p>Sala: <strong id="activeRoom"></strong></p>
      <button id="copyLink">Copiar link da sala</button>
      <p id="callStatus">Iniciando câmera...</p>

      <section id="videos" style="display:grid;
      grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
      gap:12px;margin-top:20px;"></section>

      <button id="micButton">Desligar microfone</button>
      <button id="cameraButton">Desligar câmera</button>
      <button id="leaveButton">Sair da sala</button>
    </main>
  `;

  document.getElementById("activeRoom").textContent = code;

  document.getElementById("copyLink").onclick = async () => {
    const link = location.origin + location.pathname + "?room=" + code;

    try {
      await navigator.clipboard.writeText(link);
      alert("Link copiado!");
    } catch {
      prompt("Copie o link da sala:", link);
    }
  };

  document.getElementById("leaveButton").onclick = () => {
    location.href = location.pathname;
  };

  document.getElementById("micButton").onclick = () => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    document.getElementById("micButton").textContent =
      track.enabled ? "Desligar microfone" : "Ligar microfone";
  };

  document.getElementById("cameraButton").onclick = () => {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    document.getElementById("cameraButton").textContent =
      track.enabled ? "Desligar câmera" : "Ligar câmera";
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    addVideo("Você", localStream, true);

    document.getElementById("callStatus").textContent =
      "Conectando ao servidor...";

    if (!socket.connected) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Tempo esgotado ao conectar ao servidor.")),
          20000
        );

        socket.once("connect", () => {
          clearTimeout(timeout);
          resolve();
        });

        socket.once("connect_error", () => {
          clearTimeout(timeout);
          reject(new Error("Não foi possível conectar ao servidor."));
        });

        if (socket.connected) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    socket.emit("join-room", code);

    document.getElementById("callStatus").textContent =
      "Aguardando outra pessoa entrar...";
  } catch (error) {
    console.error(error);
    document.getElementById("callStatus").textContent =
      "Erro: " + error.message;
  }
}

function addVideo(name, stream, muted = false) {
  const videos = document.getElementById("videos");
  if (!videos) return;

  const card = document.createElement("div");
  card.style.cssText =
    "background:#20283a;padding:10px;border-radius:12px;min-width:0;";

  const label = document.createElement("p");
  label.textContent = name;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.srcObject = stream;
  video.style.cssText =
    "width:100%;background:#05070b;border-radius:8px;";

  card.append(label, video);
  videos.appendChild(card);
  return { card, video };
}

function createPeer(peerId) {
  if (peers[peerId]) return peers[peerId];

  const pc = new RTCPeerConnection(configuration);
  peers[peerId] = pc;
  pendingCandidates[peerId] = [];

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("webrtc-ice-candidate", {
        targetId: peerId,
        data: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    let remote = document.getElementById("remote-" + peerId);

    if (!remote) {
      const result = addVideo("Participante", event.streams[0]);
      if (result) {
        result.card.id = "remote-" + peerId;
      }
    } else {
      const video = remote.querySelector("video");
      if (video) video.srcObject = event.streams[0];
    }

    document.getElementById("callStatus").textContent =
      "Chamada conectada!";
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      document.getElementById("callStatus").textContent =
        "Falha na conexão. Tente entrar novamente.";
    }
  };

  return pc;
}

async function addPendingCandidates(peerId, pc) {
  const candidates = pendingCandidates[peerId] || [];
  pendingCandidates[peerId] = [];

  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Erro no ICE:", error);
    }
  }
}

socket.on("room-users", async userIds => {
  for (const peerId of userIds) {
    try {
      const pc = createPeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        targetId: peerId,
        data: pc.localDescription
      });
    } catch (error) {
      console.error("Erro ao iniciar chamada:", error);
    }
  }
});

socket.on("user-joined", () => {
  const status = document.getElementById("callStatus");
  if (status) status.textContent = "Participante entrou. Conectando...";
});

socket.on("webrtc-offer", async ({ senderId, data }) => {
  try {
    const pc = createPeer(senderId);
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    await addPendingCandidates(senderId, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("webrtc-answer", {
      targetId: senderId,
      data: pc.localDescription
    });
  } catch (error) {
    console.error("Erro ao responder chamada:", error);
  }
});

socket.on("webrtc-answer", async ({ senderId, data }) => {
  try {
    const pc = peers[senderId];
    if (!pc) return;

    await pc.setRemoteDescription(new RTCSessionDescription(data));
    await addPendingCandidates(senderId, pc);
  } catch (error) {
    console.error("Erro ao aceitar resposta:", error);
  }
});

socket.on("webrtc-ice-candidate", async ({ senderId, data }) => {
  try {
    const pc = peers[senderId];
    if (!pc || !pc.remoteDescription) {
      (pendingCandidates[senderId] ||= []).push(data);
      return;
    }

    await pc.addIceCandidate(new RTCIceCandidate(data));
  } catch (error) {
    console.error("Erro no ICE:", error);
  }
});

socket.on("user-left", peerId => {
  if (peers[peerId]) {
    peers[peerId].close();
    delete peers[peerId];
  }

  const card = document.getElementById("remote-" + peerId);
  if (card) card.remove();

  const status = document.getElementById("callStatus");
  if (status) status.textContent = "Um participante saiu da sala.";
});

const roomFromLink = new URLSearchParams(location.search).get("room");

if (roomFromLink && roomInput) {
  roomInput.value = roomFromLink;
}

window.addEventListener("beforeunload", () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }

  Object.values(peers).forEach(pc => pc.close());
  socket.disconnect();
});
