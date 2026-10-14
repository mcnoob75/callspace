
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
  res.send("CallSpace Server online 🚀");
});

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.on("join-room", async (roomId) => {
    if (
      typeof roomId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(roomId)
    ) {
      return;
    }

    const room = roomId.trim();
    const existing = await io.in(room).fetchSockets();

    socket.join(room);
    socket.data.roomId = room;

    socket.emit(
      "room-users",
      existing.map((user) => user.id)
    );

    socket.to(room).emit("user-joined", socket.id);

    console.log(`${socket.id} entrou na sala ${room}`);
  });

  const relayEvents = [
    "webrtc-offer",
    "webrtc-answer",
    "webrtc-ice-candidate"
  ];

  for (const eventName of relayEvents) {
    socket.on(eventName, ({ targetId, data }) => {
      if (
        typeof targetId !== "string" ||
        !io.sockets.sockets.has(targetId)
      ) {
        return;
      }

      io.to(targetId).emit(eventName, {
        senderId: socket.id,
        data
      });
    });
  }

  socket.on("disconnect", () => {
    const room = socket.data.roomId;

    if (room) {
      socket.to(room).emit("user-left", socket.id);
    }

    console.log("Desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CallSpace rodando na porta ${PORT}`);
});
