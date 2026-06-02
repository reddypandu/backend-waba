import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    path: "/api/socket.io",
    cors: {
      origin: "*", // Set to actual frontend domain in prod
      methods: ["GET", "POST"],
    },
  });

  // Socket.io Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error("Authentication error: Token required"));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, email, role }
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `[Socket] User connected: ${socket.user.email} (ID: ${socket.user.id})`,
    );

    // Join a room specific to the user/account to receive isolated events
    socket.join(`account_${socket.user.id}`);

    socket.on("disconnect", () => {
      console.log(`[Socket] User disconnected: ${socket.user.email}`);
    });
  });

  return io;
};

export const getIo = () => {
  if (!io) {
    throw new Error("Socket.io has not been initialized!");
  }
  return io;
};

export const emitToUser = (userId, eventName, payload) => {
  if (io) {
    io.to(`account_${userId}`).emit(eventName, payload);
  }
};
