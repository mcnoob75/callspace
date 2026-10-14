const createButton = document.getElementById("createRoom");
const joinButton = document.getElementById("joinRoom");
const roomInput = document.getElementById("roomCode");

let localStream = null;
let cameraEnabled = true;
let micEnabled = true;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 10);
}

function createRoom(code) {
    const info = document.getElementById("roomInfo");
    if (info) info.remove();

    const box = document.createElement("div");
    box.id = "roomInfo";
    box.className = "room-info";

    const title = document.createElement("p");
    title.textContent = "Sala criada!";

    const codeText = document.createElement("p");
    codeText.className = "room-code";
    codeText.textContent = "Código: " + code;

    const enterButton = document.createElement("button");
    enterButton.textContent = "Entrar na sala";
    enterButton.className = "enter-room";

    const copyButton = document.createElement("button");
    copyButton.textContent = "Copiar link da sala";
    copyButton.className = "copy-room";

    copyButton.onclick = async () => {
        const link = new URL(window.location.href);
        link.hash = "room=" + code;

        try {
            await navigator.clipboard.writeText(link.href);
            alert("Link copiado!");
        } catch {
            prompt("Copie este link:", link.href);
        }
    };

    enterButton.onclick = () => showCallScreen(code);

    box.append(title, codeText, enterButton, copyButton);
    document.querySelector(".welcome").appendChild(box);
}

function showCallScreen(code) {
    document.body.innerHTML = `
        <div class="call-page">
            <header class="call-header">
                <h2>🌐 CallSpace</h2>
                <span>Sala: ${code}</span>
            </header>

            <main class="call-main">
                <div class="video-container">
                    <video id="localVideo" autoplay muted playsinline></video>
                    <div id="cameraMessage" class="camera-message">
                        <span>📷</span>
                        <p>Ative sua câmera</p>
                    </div>
                    <span class="you-label">Você</span>
                </div>

                <p class="call-status" id="callStatus">
                    Você está na sala. Convide alguém pelo link!
                </p>

                <div class="call-controls">
                    <button id="micButton" class="control-button">
                        🎙️<span>Microfone</span>
                    </button>
                    <button id="cameraButton" class="control-button">
                        📹<span>Câmera</span>
                    </button>
                    <button id="leaveButton" class="leave-button">
                        📵<span>Sair</span>
                    </button>
                </div>
            </main>
        </div>
    `;

    const video = document.getElementById("localVideo");
    const cameraMessage = document.getElementById("cameraMessage");
    const status = document.getElementById("callStatus");
    const cameraButton = document.getElementById("cameraButton");
    const micButton = document.getElementById("micButton");

    async function startCamera() {
        if (!navigator.mediaDevices?.getUserMedia) {
            status.textContent =
                "Câmera indisponível nesta prévia. Precisamos abrir o site num contexto seguro (HTTPS).";
            cameraMessage.style.display = "flex";
            return;
        }

        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            video.srcObject = localStream;
            cameraEnabled = true;
            micEnabled = true;
            cameraMessage.style.display = "none";
            status.textContent =
                "Câmera ligada. Ainda não há outros participantes conectados.";
            updateControls();
        } catch (error) {
            cameraMessage.style.display = "flex";
            status.textContent =
                "Não foi possível acessar câmera e microfone. Verifique as permissões do navegador.";
        }
    }

    function updateControls() {
        cameraButton.innerHTML = cameraEnabled
            ? "📹<span>Câmera ligada</span>"
            : "🚫<span>Câmera desligada</span>";

        micButton.innerHTML = micEnabled
            ? "🎙️<span>Microfone ligado</span>"
            : "🔇<span>Microfone desligado</span>";

        cameraMessage.style.display = cameraEnabled ? "none" : "flex";
    }

    cameraButton.onclick = () => {
        if (!localStream) {
            startCamera();
            return;
        }

        cameraEnabled = !cameraEnabled;
        localStream.getVideoTracks().forEach(track => {
            track.enabled = cameraEnabled;
        });
        updateControls();
    };

    micButton.onclick = () => {
        if (!localStream) {
            startCamera();
            return;
        }

        micEnabled = !micEnabled;
        localStream.getAudioTracks().forEach(track => {
            track.enabled = micEnabled;
        });
        updateControls();
    };

    document.getElementById("leaveButton").onclick = () => {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        cameraEnabled = true;
        micEnabled = true;
        window.location.hash = "";
        window.location.reload();
    };

    startCamera();
}

createButton.addEventListener("click", () => {
    createRoom(generateRoomCode());
});

joinButton.addEventListener("click", () => {
    const code = roomInput.value.trim();

    if (!code) {
        alert("Digite o código da sala!");
        return;
    }

    createRoom(code);
});