import { Room, Client } from '@colyseus/core';
import { Schema, defineTypes, MapSchema, ArraySchema, type } from '@colyseus/schema';
import * as coordinator from '../tournament/coordinator.js';
import { setTournamentRoomInstance } from '../tournament/coordinator.js';
import { createClient } from '@supabase/supabase-js';

// --- Schema definitions for state sync ---

export class ModuleState extends Schema {
  instanceId: string = '';
  moduleType: string = '';
  order: number = 0;
}
defineTypes(ModuleState, {
  instanceId: 'string',
  moduleType: 'string',
  order: 'number',
});

export class TableState extends Schema {
  runtimeTableId: string = '';
  tableNumber: number = 0;
  moduleInstanceId: string = '';
  localSlotId: string = '';
}
defineTypes(TableState, {
  runtimeTableId: 'string',
  tableNumber: 'number',
  moduleInstanceId: 'string',
  localSlotId: 'string',
});

export class PairingState extends Schema {
  roundNumber: number = 0;
  boardNumber: number = 0;
  whitePlayerId: string = '';
  blackPlayerId: string = '';
  whiteUsername: string = '';
  blackUsername: string = '';
  tableNumber: number = 0;
  runtimeTableId: string = '';
  result: string = '';
  resultReason: string = '';
  isBye: boolean = false;
  byePlayerId: string = '';
  presenceDeadline: string = '';
  startedAt: string = '';
  completedAt: string = '';
}
defineTypes(PairingState, {
  roundNumber: 'number',
  boardNumber: 'number',
  whitePlayerId: 'string',
  blackPlayerId: 'string',
  whiteUsername: 'string',
  blackUsername: 'string',
  tableNumber: 'number',
  runtimeTableId: 'string',
  result: 'string',
  resultReason: 'string',
  isBye: 'boolean',
  byePlayerId: 'string',
  presenceDeadline: 'string',
  startedAt: 'string',
  completedAt: 'string',
});

export class RegistrationState extends Schema {
  playerId: string = '';
  username: string = '';
  rating: number = 0;
}
defineTypes(RegistrationState, {
  playerId: 'string',
  username: 'string',
  rating: 'number',
});

export class StandingState extends Schema {
  position: number = 0;
  playerId: string = '';
  username: string = '';
  rating: number = 0;
  points: number = 0;
  wins: number = 0;
  draws: number = 0;
  losses: number = 0;
  buchholz: number = 0;
  isChampion: boolean = false;
}
defineTypes(StandingState, {
  position: 'number',
  playerId: 'string',
  username: 'string',
  rating: 'number',
  points: 'number',
  wins: 'number',
  draws: 'number',
  losses: 'number',
  buchholz: 'number',
  isChampion: 'boolean',
});

export class TournamentArenaState extends Schema {
  status: string = 'idle';
  tournamentId: string = '';
  startsAt: string = '';
  serverNow: string = '';
  currentRound: number = 0;
  totalRounds: number = 0;
  playerCount: number = 0;
  timeControlLabel: string = '';
  timeControlCategory: string = '';
  baseTimeSeconds: number = 300;
  incrementSeconds: number = 0;
  roundMode: string = 'auto-normal';
  practiceTablesLocked: boolean = false;
  doorOpen: boolean = false;
  lastStatus: string = '';

  modules: ArraySchema<ModuleState> = new ArraySchema<ModuleState>();
  tables: ArraySchema<TableState> = new ArraySchema<TableState>();
  pairings: ArraySchema<PairingState> = new ArraySchema<PairingState>();
  registrations: ArraySchema<RegistrationState> = new ArraySchema<RegistrationState>();
  standings: ArraySchema<StandingState> = new ArraySchema<StandingState>();
}
defineTypes(TournamentArenaState, {
  status: 'string',
  tournamentId: 'string',
  startsAt: 'string',
  serverNow: 'string',
  currentRound: 'number',
  totalRounds: 'number',
  playerCount: 'number',
  timeControlLabel: 'string',
  timeControlCategory: 'string',
  baseTimeSeconds: 'number',
  incrementSeconds: 'number',
  roundMode: 'string',
  practiceTablesLocked: 'boolean',
  doorOpen: 'boolean',
  lastStatus: 'string',
  modules: [ModuleState],
  tables: [TableState],
  pairings: [PairingState],
  registrations: [RegistrationState],
  standings: [StandingState],
});

interface JoinOptions {
  accessToken: string;
}

export class TournamentRoom extends Room<TournamentArenaState> {
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private presentPlayers = new Map<string, string>(); // sessionId -> playerId

  async onCreate(_options: any) {
    this.setState(new TournamentArenaState());
    this.autoDispose = false;
    this.maxClients = 50;
    setTournamentRoomInstance(this);

    this.onMessage('refresh', async () => {
      await this.syncState();
    });

    this.onMessage('register', async (client, data: { username: string; rating: number }) => {
      const playerId = this.presentPlayers.get(client.sessionId);
      if (!playerId) return;
      const tournamentId = this.state.tournamentId;
      if (!tournamentId) return;

      const result = await coordinator.registerPlayer(tournamentId, playerId, data.username, data.rating);
      if (result.success) {
        await this.syncState();
      } else {
        client.send('registerError', { error: result.error });
      }
    });

    this.onMessage('unregister', async (client) => {
      const playerId = this.presentPlayers.get(client.sessionId);
      if (!playerId) return;
      const tournamentId = this.state.tournamentId;
      if (!tournamentId) return;

      const result = await coordinator.unregisterPlayer(tournamentId, playerId);
      if (result.success) {
        await this.syncState();
      }
    });

    this.onMessage('reportResult', async (_client, data: { roundNumber: number; boardNumber: number; result: string; reason: string }) => {
      const tournamentId = this.state.tournamentId;
      if (!tournamentId) return;
      await coordinator.reportMatchResult(tournamentId, data.roundNumber, data.boardNumber, data.result, data.reason);
      await this.syncState();
    });

    await this.syncState();

    this.refreshInterval = setInterval(async () => {
      await this.syncState();
    }, 3000);
  }

  async onAuth(_client: Client, options: JoinOptions): Promise<any> {
    if (!options.accessToken) return false;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return false;

    try {
      const supabase = createClient(url, key);
      const { data, error } = await supabase.auth.getUser(options.accessToken);
      if (error || !data.user) return false;
      return { userId: data.user.id, email: data.user.email };
    } catch {
      return false;
    }
  }

  async onJoin(client: Client, _options: JoinOptions, auth: any) {
    if (auth?.userId) {
      this.presentPlayers.set(client.sessionId, auth.userId);
    }
    client.send('fullState', this.getSerializableState());
  }

  onLeave(client: Client) {
    this.presentPlayers.delete(client.sessionId);
  }

  onDispose() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    setTournamentRoomInstance(null);
  }

  isPlayerPresent(playerId: string): boolean {
    return Array.from(this.presentPlayers.values()).includes(playerId);
  }

  public async syncFromCoordinator(): Promise<void> {
    await this.syncState();
  }

  private async syncState(): Promise<void> {
    try {
      const [current, config] = await Promise.all([
        coordinator.getCurrentInstance(),
        coordinator.loadConfig(),
      ]);

      this.state.serverNow = new Date().toISOString();

      if (config) {
        this.state.timeControlLabel = config.timeControl.displayLabel;
        this.state.timeControlCategory = config.timeControl.category;
        this.state.baseTimeSeconds = config.timeControl.baseTimeSeconds;
        this.state.incrementSeconds = config.timeControl.incrementSeconds;
        this.state.roundMode = config.swissConfig.roundMode;
      }

      if (current) {
        this.state.tournamentId = current.id;
        this.state.status = current.status;
        this.state.startsAt = current.startsAt || '';
        this.state.currentRound = current.currentRound;
        this.state.totalRounds = current.totalRounds;
        this.state.playerCount = current.playerCount;

        const isArenaVisible = current.status === 'round_active' || current.status === 'between_rounds';
        this.state.practiceTablesLocked = ['starting', 'round_active', 'between_rounds', 'finalizing'].includes(current.status);

        if (isArenaVisible && current.arenaLayout) {
          this.state.doorOpen = true;
          this.syncModules(current.arenaLayout);
        } else {
          this.state.doorOpen = false;
          this.state.modules.clear();
          this.state.tables.clear();
          (this as any)._lastModuleSig = '';
        }

        const regs = await coordinator.getRegistrations(current.id);
        this.syncRegistrations(regs);

        if (current.currentRound > 0) {
          const pairings = await coordinator.getPairings(current.id);
          this.syncPairings(pairings);
        } else {
          this.state.pairings.clear();
        }

        if (current.status !== 'registration_open') {
          const standings = await coordinator.getStandings(current.id);
          this.syncStandings(standings);
          this.state.lastStatus = '';
        } else {
          const lastCompleted = await coordinator.getLatestCompletedInstance();
          if (lastCompleted) {
            const standings = await coordinator.getStandings(lastCompleted.id);
            this.syncStandings(standings);
            this.state.lastStatus = 'completed';
          } else {
            this.state.standings.clear();
            this.state.lastStatus = '';
          }
        }
      } else {
        this.state.status = 'idle';
        this.state.tournamentId = '';
        this.state.modules.clear();
        this.state.tables.clear();
        this.state.pairings.clear();
        this.state.registrations.clear();
        this.state.doorOpen = false;
        this.state.practiceTablesLocked = false;

        const lastCompleted = await coordinator.getLatestCompletedInstance();
        const lastCancelled = await coordinator.getLatestCancelledInstance();

        if (lastCompleted) {
          const cancelledIsNewer = lastCancelled &&
            lastCancelled.completedAt && lastCompleted.completedAt &&
            new Date(lastCancelled.completedAt) > new Date(lastCompleted.completedAt);

          if (cancelledIsNewer) {
            this.state.lastStatus = 'cancelled_insufficient_players';
          } else {
            this.state.lastStatus = 'completed';
          }

          const standings = await coordinator.getStandings(lastCompleted.id);
          this.syncStandings(standings);
        } else if (lastCancelled) {
          this.state.lastStatus = 'cancelled_insufficient_players';
          this.state.standings.clear();
        } else {
          this.state.lastStatus = '';
          this.state.standings.clear();
        }
      }
    } catch (err) {
      console.error('[TournamentRoom] syncState error:', (err as Error).message);
    }
  }

  private syncModules(layout: coordinator.ArenaLayout): void {
    const sig = layout.modules.map(m => `${m.instanceId}:${m.type}:${m.order}`).join('|')
      + '||' + layout.tables.map(t => `${t.runtimeTableId}:${t.tableNumber}:${t.moduleInstanceId}:${t.localSlotId}`).join('|');

    if ((this as any)._lastModuleSig === sig) return;
    (this as any)._lastModuleSig = sig;

    this.state.modules.clear();
    for (const mod of layout.modules) {
      const ms = new ModuleState();
      ms.instanceId = mod.instanceId;
      ms.moduleType = mod.type;
      ms.order = mod.order;
      this.state.modules.push(ms);
    }

    this.state.tables.clear();
    for (const table of layout.tables) {
      const ts = new TableState();
      ts.runtimeTableId = table.runtimeTableId;
      ts.tableNumber = table.tableNumber;
      ts.moduleInstanceId = table.moduleInstanceId;
      ts.localSlotId = table.localSlotId;
      this.state.tables.push(ts);
    }
  }

  private syncRegistrations(regs: coordinator.Registration[]): void {
    if (this.state.registrations.length !== regs.length) {
      this.state.registrations.clear();
      for (const reg of regs) {
        const rs = new RegistrationState();
        rs.playerId = reg.playerId;
        rs.username = reg.username;
        rs.rating = reg.rating;
        this.state.registrations.push(rs);
      }
    }
  }

  private syncPairings(pairings: coordinator.PairingRecord[]): void {
    this.state.pairings.clear();
    for (const p of pairings) {
      const ps = new PairingState();
      ps.roundNumber = p.roundNumber;
      ps.boardNumber = p.boardNumber;
      ps.whitePlayerId = p.whitePlayerId || '';
      ps.blackPlayerId = p.blackPlayerId || '';
      ps.whiteUsername = p.whiteUsername || '';
      ps.blackUsername = p.blackUsername || '';
      ps.tableNumber = p.tableNumber;
      ps.runtimeTableId = p.runtimeTableId || '';
      ps.result = p.result || '';
      ps.resultReason = p.resultReason || '';
      ps.isBye = p.isBye;
      ps.byePlayerId = p.byePlayerId || '';
      ps.presenceDeadline = p.presenceDeadline || '';
      ps.startedAt = p.startedAt || '';
      ps.completedAt = p.completedAt || '';
      this.state.pairings.push(ps);
    }
  }

  private syncStandings(standings: any[]): void {
    this.state.standings.clear();
    for (const s of standings) {
      const ss = new StandingState();
      ss.position = s.position;
      ss.playerId = s.player_id;
      ss.username = s.username;
      ss.rating = s.rating;
      ss.points = Number(s.points) || 0;
      ss.wins = s.wins || 0;
      ss.draws = s.draws || 0;
      ss.losses = s.losses || 0;
      ss.buchholz = Number(s.buchholz) || 0;
      ss.isChampion = s.is_champion || false;
      this.state.standings.push(ss);
    }
  }

  private getSerializableState(): any {
    return {
      status: this.state.status,
      tournamentId: this.state.tournamentId,
      startsAt: this.state.startsAt,
      serverNow: this.state.serverNow,
      currentRound: this.state.currentRound,
      totalRounds: this.state.totalRounds,
      playerCount: this.state.playerCount,
      timeControlLabel: this.state.timeControlLabel,
      timeControlCategory: this.state.timeControlCategory,
      baseTimeSeconds: this.state.baseTimeSeconds,
      incrementSeconds: this.state.incrementSeconds,
      roundMode: this.state.roundMode,
      practiceTablesLocked: this.state.practiceTablesLocked,
      doorOpen: this.state.doorOpen,
    };
  }
}
