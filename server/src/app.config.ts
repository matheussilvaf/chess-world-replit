import type { ConfigOptions } from "@colyseus/tools";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { TournamentRoom } from "./rooms/TournamentRoom.js";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";
import { tournamentRouter } from "./tournament/routes.js";
import { coordinatorRouter } from "./tournament/coordinatorRoutes.js";
import { startCoordinator } from "./tournament/coordinator.js";
import { getCharacterConfig } from "./combat/characterConfigService.js";
import { rigsAdminRouter, publicRigConfigHandler } from "./rigs/routes.js";
import {
  weaponFamiliesAdminRouter,
  weaponProfilesAdminRouter,
  publicWeaponFamiliesHandler,
  publicWeaponProfileHandler,
} from "./rigs/weaponRoutes.js";
import {
  craftItemsAdminRouter,
  craftRecipesAdminRouter,
  publicCraftDataHandler,
} from "./craft/craftRoutes.js";
import { publicStationsDataHandler, stationsAdminRouter } from "./craft/stationRoutes.js";
import {
  collectionAdminRouter,
  publicCollectionConfigHandler,
} from "./collection/collectionRoutes.js";
import { collectionInventoryRouter } from "./collection/inventoryRoutes.js";
import {
  assetCategoriesAdminRouter,
  publicAssetCategoryDataHandler,
} from "./assets/assetCategoryRoutes.js";
import { playerCharacterRouter } from "./characters/playerCharacterRoutes.js";

const config: ConfigOptions = {
  // Explicit liveness probing: without app-level pings a half-open socket
  // (phone in airplane mode, killed process behind a proxy) can linger as a
  // "connected" ghost for ~15 minutes until TCP gives up — long enough to
  // hold W.O. decisions and matches hostage. 3s × 2 retries ≈ dead sockets
  // detected within ~9 seconds.
  initializeTransport: (options) => new WebSocketTransport({
    ...options,
    pingInterval: 3000,
    pingMaxRetries: 2,
  }),

  initializeGameServer: (gameServer) => {
    gameServer.define("world", WorldRoom).filterBy(["region"]);
    gameServer.define("arena", WorldRoom).filterBy(["region"]);
    gameServer.define("tournament", TournamentRoom).filterBy(["tournamentId"]);
  },

  initializeExpress: (app) => {
    // NOTE: @colyseus/tools already registered express.json() (100kb cap)
    // BEFORE this hook runs, so adding a bigger json parser here is dead code.
    // Large uploads must avoid JSON: the craft icon route takes raw image
    // bytes via express.raw (json() ignores non-application/json bodies).

    const allowedOrigins = [
      process.env.CLIENT_ORIGIN,
      'https://chessworld.app',
      /\.webcontainer-api\.io$/,
      /\.local-credentialless\.webcontainer-api\.io$/,
      /\.replit\.dev$/,
      /\.replit\.app$/,
      /\.repl\.co$/,
    ].filter(Boolean) as (string | RegExp)[];

    // Replit dev proxy serves this artifact under /api WITHOUT stripping the
    // prefix, but Colyseus mounts its matchmake routes at the server root.
    // Rewrite /api/matchmake/* -> /matchmake/* so the client can use
    // wss://<domain>/api as its endpoint. Harmless on Colyseus Cloud.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.url.startsWith('/api/matchmake/') || req.url.startsWith('/api/voice/')) {
        req.url = req.url.slice(4);
      }
      next();
    });

    app.use(cors({
      origin: (origin, callback) => {
        // Allow same-origin and server-to-server requests (no origin header)
        if (!origin) return callback(null, true);
        const allowed = allowedOrigins.some(o => {
          if (typeof o === 'string') return o === origin;
          if (o instanceof RegExp) return o.test(origin);
          return false;
        });
        callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
      },
      credentials: true,
    }));

    app.get("/health", (_req: Request, res: Response) => {
      res.json({ ok: true, uptime: process.uptime() });
    });

    // Platform health probe endpoint expected by artifact config
    app.get("/api/healthz", (_req: Request, res: Response) => {
      res.json({ status: "ok", uptime: process.uptime() });
    });

    // Character combat config (read-only; written by the /admin/characters
    // editor straight to Supabase — this endpoint exposes the validated,
    // server-cached view of it).
    app.get("/api/characters/:characterId/config", async (req: Request, res: Response) => {
      const characterId = String(req.params.characterId || "");
      if (!/^character\d{2,4}$/.test(characterId)) {
        res.status(400).json({ error: "characterId inválido (esperado character01, character02, …)" });
        return;
      }
      const config = await getCharacterConfig(characterId);
      if (!config) {
        res.status(404).json({ error: `Nenhuma config válida para ${characterId}` });
        return;
      }
      res.json(config);
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

    // Character Rig Controller (spec: /admin/rigs). Admin CRUD requires a
    // Supabase JWT; the public GET is the read-only view game clients use.
    app.get("/api/rigs/:rigId", publicRigConfigHandler);
    app.use("/api/admin/rigs", rigsAdminRouter);

    // Weapon hitbox profiles + persistent family catalog (spec §25). Public
    // routes are read-only and cached; admin routes require a Supabase JWT.
    app.get("/api/weapon-families", publicWeaponFamiliesHandler);
    app.get("/api/weapon-hitbox-profiles/:profileId", publicWeaponProfileHandler);
    app.use("/api/admin/weapon-families", weaponFamiliesAdminRouter);
    app.use("/api/admin/weapon-hitbox-profiles", weaponProfilesAdminRouter);

    // Craft system (spec: /admin/craft): admin CRUD de craft items + receitas;
    // GET público read-only e cacheado (o futuro painel de craft do jogador lê daqui).
    app.get("/api/craft-data", publicCraftDataHandler);
    app.use("/api/admin/craft-items", craftItemsAdminRouter);
    app.use("/api/admin/craft-recipes", craftRecipesAdminRouter);

    // Estações de criação (spec: /admin/stations): abas + layout por estação
    // e vínculo item→estação; GET público cacheado (painel de estação do jogo).
    app.get("/api/craft-stations-data", publicStationsDataHandler);
    app.use("/api/admin/craft-stations", stationsAdminRouter);

    // Mundo de Coleta: config única (quantidades de minérios + hurtboxes).
    // GET público cacheado — o runtime do mapa lê ao entrar no mundo.
    app.get("/api/collection-world-config", publicCollectionConfigHandler);
    // Inventário de coleta (jogador autenticado, não-admin).
    app.use("/api/collection", collectionInventoryRouter);
    app.use("/api/admin/collection-world-config", collectionAdminRouter);

    // Assets Controller (spec: /admin/assets-controller): categorias de
    // permissão de assets; GET público cacheado para features futuras.
    app.get("/api/asset-category-data", publicAssetCategoryDataHandler);
    app.use("/api/admin/asset-categories", assetCategoriesAdminRouter);

    // Personagem jogável (criação/consulta do próprio) — exige Supabase JWT.
    app.use("/api/me/character", playerCharacterRouter);

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