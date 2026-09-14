import { Schema, defineTypes } from '@colyseus/schema';

export class PlayerState extends Schema {
  id!: string;
  sessionId!: string;
  username!: string;
  rating!: number;
  region!: string;
  x!: number;
  y!: number;
  targetX!: number;
  targetY!: number;
  direction!: string;
  isMoving!: boolean;
  currentBoardId!: string;
  characterId!: string;
  hp!: number;
  maxHp!: number;
  /** Receita canônica da aparência composta ('' = personagem não criado). */
  appearance!: string;
  /** Ref da arma equipada (gen:weapon/...; '' = nada equipado). */
  equippedWeapon!: string;
  /** Energia (fome) — espelho do snapshot de progresso, visível aos outros (barra acima do jogador). */
  energy!: number;
  maxEnergy!: number;
  /** "NV" = soma dos níveis de todas as habilidades (aparece junto da barra de HP no mapa). */
  level!: number;

  constructor() {
    super();
    this.id = '';
    this.sessionId = '';
    this.username = '';
    this.rating = 0;
    this.region = '';
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.direction = 'down';
    this.isMoving = false;
    this.currentBoardId = '';
    this.characterId = '';
    this.hp = 100;
    this.maxHp = 100;
    this.appearance = '';
    this.equippedWeapon = '';
    this.energy = 0;
    this.maxEnergy = 0;
    this.level = 0;
  }
}

defineTypes(PlayerState, {
  id: 'string',
  sessionId: 'string',
  username: 'string',
  rating: 'number',
  region: 'string',
  x: 'number',
  y: 'number',
  targetX: 'number',
  targetY: 'number',
  direction: 'string',
  isMoving: 'boolean',
  currentBoardId: 'string',
  characterId: 'string',
  hp: 'number',
  // Appended last on purpose: schema field order is part of the wire
  // protocol for the pinned colyseus.js 0.15 clients — additive only.
  maxHp: 'number',
  appearance: 'string',
  equippedWeapon: 'string',
  energy: 'number',
  maxEnergy: 'number',
  level: 'number',
});
