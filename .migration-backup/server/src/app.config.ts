import type { ConfigOptions } from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { TournamentRoom } from "./rooms/TournamentRoom.js";
import type { Request, Response } from "express";
import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";
import { tournamentRouter } from "./tournament/routes.js";
import { coordinatorRouter } from "./tournament/coordinatorRoutes.js";
import { startCoordinator } from "./tournament/coordinator.js";

const config: ConfigOptions = {
  initializeGameServer: (gameServer) => {
    gameServer.define("world", WorldRoom).filterBy(["region"]);
    gameServer.define("arena", WorldRoom).filterBy(["region"]);
    gameServer.define("tournament", TournamentRoom).filterBy(["tournamentId"]);
  },

  initializeExpress: (app) => {
    app.use(express.json());

    const allowedOrigins = [
      process.env.CLIENT_ORIGIN,
      'https://chessworld.app',
      /\.webcontainer-api\.io$/,
      /\.local-credentialless\.webcontainer-api\.io$/,
    ].filter(Boolean);

    app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowed = allowedOrigins.some(o => {
          if (typeof o === 'string') return o === origin;
          if (o instanceof RegExp) return o.test(origin);
          return false;
        });
        callback(null, allowed || true);
      },
      credentials: true,
    }));

    app.get("/health", (_req: Request, res: Response) => {
      res.json({ ok: true, uptime: process.uptime() });
    });

    app.post("/voice/token", async (req: Request, res: Response) => {
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      const livekitUrl = process.env.LIVEKIT_URL;

      if (!apiKey || !apiSecret || !livekitUrl) {
        res.status(500).json({ error: "LiveKit environment variables not configured" });
        return;
      }

      const { roomName, identity, name } = req.body || {};

      if (!roomName || !identity || !name) {
        res.status(400).json({ error: "Missing required fields: roomName, identity, name" });
        return;
      }

      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name,
        ttl: '6h',
      });

      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
      });

      const jwt = await token.toJwt();

      res.json({
        token: jwt,
        url: livekitUrl,
        roomName,
      });
    });

    app.use("/api/tournament", tournamentRouter);
    app.use("/api/coordinator", coordinatorRouter);

    app.use("/colyseus", monitor());

    startCoordinator().catch(err => {
      console.error('[AppConfig] Failed to start coordinator:', err.message);
    });
  },
};

export default config;

//deploy