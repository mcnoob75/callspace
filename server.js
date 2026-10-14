
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get("/", (req, res) => {
  res.status(200).send("CallSpace Server online 🚀");
});

function validRoomId(value) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function cleanName(value) {
  if (typeof value !== "string") return "Participante";

  const name = value.trim().slice(0, 30);
  return name || "Participante";
}

async function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const user = {
    id: socket.id,
    displayName: socket.data.displayName
  };

  socket.data.roomId = null;
  await socket.leave(roomId);

  socket.to(roomId).emit("user-left", user);
  console.log(`${user.displayName} saiu da sala ${roomId}`);
}

io.on("connection", socket => {
  console.log("Conectado:", socket.id);

  socket.on("join-room", async payload => {
    try {
      const roomId = typeof payload === "string"
        ? payload.trim()
        : payload?.roomId?.trim();

      const displayName = cleanName(
        typeof payload === "string" ? "Participante" : payload?.displayName
      );

      if (!validRoomId(roomId)) {
        socket.emit("room-error", "Código de sala inválido.");
        return;
      }

      if (socket.data.roomId === roomId) return;

      await leaveCurrentRoom(socket);

      const existingSockets = await io.in(roomId).fetchSockets();

      const users = existingSockets.map(user => ({
        id: user.id,
        displayName: user.data.displayName || "Participante"
      }));

      socket.data.roomId = roomId;
      socket.data.displayName = displayName;

      await socket.join(roomId);

      socket.emit("room-users", users);
      socket.emit("room-joined", {
        roomId,
        message: users.length
          ? "Entrou na sala. Conectando aos participantes..."
          : "Sala criada! Aguardando participantes..."
      });

      socket.to(roomId).emit("user-joined", {
        id: socket.id,
        displayName
      });

      console.log(`${displayName} entrou na sala ${roomId}`);
    } catch (error) {
      console.error("Erro ao entrar na sala:", error);
      socket.emit("room-error", "Erro ao entrar na sala. Tente novamente.");
    }
  });

  const relayEvents = [
    "webrtc-offer",
    "webrtc-answer",
    "webrtc-ice-candidate"
  ];

  for (const eventName of relayEvents) {
    socket.on(eventName, payload => {
      if (!payload || typeof payload.targetId !== "string") return;
      if (!socket.data.roomId) return;

      const target = io.sockets.sockets.get(payload.targetId);
      if (!target) return;

      // Só encaminha sinalização entre pessoas da mesma sala.
      if (target.data.roomId !== socket.data.roomId) return;

      target.emit(eventName, {
        senderId: socket.id,
        senderName: socket.data.displayName || "Participante",
        data: payload.data
      });
    });
  }

  socket.on("leave-room", async () => {
    await leaveCurrentRoom(socket);
  });

  socket.on("disconnect", async () => {
    await leaveCurrentRoom(socket);
    console.log("Desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CallSpace rodando na porta ${PORT}`);
});
