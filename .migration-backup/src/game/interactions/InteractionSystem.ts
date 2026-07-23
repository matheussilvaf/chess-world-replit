import Phaser from 'phaser';

export type InteractionCategory =
  | 'chess_table'
  | 'player_seat'
  | 'spectator_seat'
  | 'house'
  | 'building'
  | 'portal'
  | 'village_gateway'
  | 'stats_board'
  | 'world_zone';

export type TriggerMode = 'click' | 'proximity';

export interface InteractionObject {
  id: number;
  name: string;
  category: InteractionCategory;
  triggerMode: TriggerMode;
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, string | number | boolean>;
  anchor?: { x: number; y: number };
  interactionRadius: number;
}

export interface InteractionEvent {
  object: InteractionObject;
  playerDistance: number;
}

export interface ZoneChangeEvent {
  zoneId: string;
  zoneName: string;
  zoneType: string;
  entered: boolean;
}

interface CharacterAnchor {
  name: string;
  x: number;
  y: number;
  tableId: string;
  role: string;
  position?: string;
  side?: string;
  seatIndex?: string;
}

export class InteractionSystem {
  private scene: Phaser.Scene;
  private interactions: InteractionObject[] = [];
  private zones: InteractionObject[] = [];
  private anchors: CharacterAnchor[] = [];
  private proximityActive: InteractionObject | null = null;
  private currentZone: InteractionObject | null = null;
  private interactiveZones: Map<number, Phaser.GameObjects.Zone> = new Map();

  // Callbacks
  public onInteractionClick?: (event: InteractionEvent) => void;
  public onProximityEnter?: (event: InteractionEvent) => void;
  public onProximityExit?: (obj: InteractionObject) => void;
  public onZoneChange?: (event: ZoneChangeEvent) => void;

  private getPlayerPos: () => { x: number; y: number };
  private navigateToFn: (x: number, y: number) => void;
  private pendingNavigation: InteractionObject | null = null;

  constructor(
    scene: Phaser.Scene,
    getPlayerPos: () => { x: number; y: number },
    navigateTo: (x: number, y: number) => void,
  ) {
    this.scene = scene;
    this.getPlayerPos = getPlayerPos;
    this.navigateToFn = navigateTo;
  }

  public loadFromTMJ(tmjData: any) {
    this.loadChessTablesInteractions(tmjData);
    this.loadHouseInteractions(tmjData);
    this.loadBuildingInteractions(tmjData);
    this.loadPortalInteractions(tmjData);
    this.loadVillageInteractions(tmjData);
    this.loadWorldZones(tmjData);
    this.loadCharacterAnchors(tmjData);
    this.createInteractiveZones();
  }

  private findObjectLayer(layers: any[], name: string): any[] | null {
    for (const l of layers) {
      if (l.type === 'group') {
        const found = this.findObjectLayer(l.layers || [], name);
        if (found) return found;
      } else if (l.type === 'objectgroup' && l.name === name) {
        return l.objects || [];
      }
    }
    return null;
  }

  private getProps(obj: any): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const p of obj.properties || []) {
      result[p.name] = p.value;
    }
    return result;
  }

  private loadChessTablesInteractions(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'chess_tables_interactions');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      const interaction = props.interaction as string;
      const tableId = props.tableId as string;

      let category: InteractionCategory;
      if (interaction === 'board') category = 'chess_table';
      else if (interaction === 'player_seat') category = 'player_seat';
      else if (interaction === 'spectator_seat') category = 'spectator_seat';
      else continue;

      const anchor = this.findAnchorForChessObject(tableId, interaction, props.position as string, props);

      this.interactions.push({
        id: obj.id,
        name: obj.name,
        category,
        triggerMode: 'click',
        x: obj.x,
        y: obj.y,
        width: obj.width || 0,
        height: obj.height || 0,
        properties: props,
        anchor,
        interactionRadius: category === 'chess_table' ? 120 : 80,
      });
    }
  }

  private findAnchorForChessObject(
    tableId: string,
    interaction: string,
    position: string | undefined,
    props: Record<string, string | number | boolean>,
  ): { x: number; y: number } | undefined {
    // Anchors are loaded after all interactions, so defer lookup to runtime
    // Store enough info to resolve later
    const key = `${tableId}_${interaction}_${position || props.side || ''}`;
    (this as any).__deferredAnchorKey = key;
    return undefined; // Will be resolved in resolveAnchors()
  }

  private loadHouseInteractions(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'house_interactions');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      this.interactions.push({
        id: obj.id,
        name: obj.name,
        category: 'house',
        triggerMode: 'proximity',
        x: obj.x,
        y: obj.y,
        width: obj.width || 0,
        height: obj.height || 0,
        properties: props,
        interactionRadius: 60,
      });
    }
  }

  private loadBuildingInteractions(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'building_interactions');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      const interactionType = props.interactionType as string;

      let category: InteractionCategory;
      if (interactionType === 'stats_board') category = 'stats_board';
      else category = 'building';

      this.interactions.push({
        id: obj.id,
        name: obj.name,
        category,
        triggerMode: 'proximity',
        x: obj.x,
        y: obj.y,
        width: obj.width || 0,
        height: obj.height || 0,
        properties: props,
        interactionRadius: 80,
      });
    }
  }

  private loadPortalInteractions(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'portal_interactions');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      this.interactions.push({
        id: obj.id,
        name: obj.name,
        category: 'portal',
        triggerMode: 'proximity',
        x: obj.x,
        y: obj.y,
        width: obj.width || 0,
        height: obj.height || 0,
        properties: props,
        interactionRadius: 70,
      });
    }
  }

  private loadVillageInteractions(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'village_interactions');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      this.interactions.push({
        id: obj.id,
        name: obj.name,
        category: 'village_gateway',
        triggerMode: 'proximity',
        x: obj.x,
        y: obj.y,
        width: obj.width || 0,
        height: obj.height || 0,
        properties: props,
        interactionRadius: 70,
      });
    }
  }

  private loadWorldZones(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'world_zones');
    if (!objects) return;

    for (const obj of objects) {
      if (!obj.width || !obj.height) continue;
      const props = this.getProps(obj);
      if (!props.zoneId) continue;

      this.zones.push({
        id: obj.id,
        name: obj.name,
        category: 'world_zone',
        triggerMode: 'proximity',
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        properties: props,
        interactionRadius: 0,
      });
    }
  }

  private loadCharacterAnchors(tmjData: any) {
    const objects = this.findObjectLayer(tmjData.layers, 'character_anchors');
    if (!objects) return;

    for (const obj of objects) {
      const props = this.getProps(obj);
      if (props.anchorType !== 'chess_seat') continue;
      this.anchors.push({
        name: obj.name,
        x: obj.x,
        y: obj.y,
        tableId: props.tableId as string,
        role: props.role as string,
        position: props.position as string | undefined,
        side: props.side as string | undefined,
        seatIndex: props.seatIndex as string | undefined,
      });
    }

    this.resolveAnchors();
  }

  private resolveAnchors() {
    for (const interaction of this.interactions) {
      if (interaction.category === 'chess_table') {
        // Board: use the player_bottom anchor (closest walkable point)
        const anchor = this.anchors.find(
          a => a.tableId === interaction.properties.tableId && a.role === 'player' && a.position === 'bottom',
        );
        if (anchor) interaction.anchor = { x: anchor.x, y: anchor.y };
      } else if (interaction.category === 'player_seat') {
        const pos = interaction.properties.position as string;
        const normalizedPos = pos?.startsWith('bottom') ? 'bottom' : 'top';
        const anchor = this.anchors.find(
          a => a.tableId === interaction.properties.tableId && a.role === 'player' && a.position === normalizedPos,
        );
        if (anchor) interaction.anchor = { x: anchor.x, y: anchor.y };
      } else if (interaction.category === 'spectator_seat') {
        const pos = interaction.properties.position as string;
        // spectator_left -> side=left, seatIndex=1
        const anchor = this.anchors.find(
          a =>
            a.tableId === interaction.properties.tableId &&
            a.role === 'spectator' &&
            a.side === pos &&
            a.seatIndex === '1',
        );
        if (anchor) interaction.anchor = { x: anchor.x, y: anchor.y };
      }
    }
  }

  private createInteractiveZones() {
    // Only create clickable zones for click-trigger interactions (chess tables/seats)
    for (const interaction of this.interactions) {
      if (interaction.triggerMode !== 'click') continue;
      if (interaction.width === 0 || interaction.height === 0) continue;

      const cx = interaction.x + interaction.width / 2;
      const cy = interaction.y + interaction.height / 2;
      const zone = this.scene.add.zone(cx, cy, interaction.width, interaction.height);
      zone.setInteractive({ useHandCursor: true });
      zone.setDepth(50);

      zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        pointer.event.stopPropagation();
        this.handleClickInteraction(interaction);
      });

      this.interactiveZones.set(interaction.id, zone);
    }
  }

  private handleClickInteraction(interaction: InteractionObject) {
    const playerPos = this.getPlayerPos();
    const targetX = interaction.anchor?.x ?? (interaction.x + interaction.width / 2);
    const targetY = interaction.anchor?.y ?? (interaction.y + interaction.height / 2);
    const dist = Phaser.Math.Distance.Between(playerPos.x, playerPos.y, targetX, targetY);

    // Chess interactions open immediately (no walk required)
    if (
      interaction.category === 'chess_table' ||
      interaction.category === 'player_seat' ||
      interaction.category === 'spectator_seat'
    ) {
      this.onInteractionClick?.({ object: interaction, playerDistance: dist });
      return;
    }

    if (dist <= interaction.interactionRadius) {
      this.onInteractionClick?.({ object: interaction, playerDistance: dist });
    } else {
      this.pendingNavigation = interaction;
      if (interaction.anchor) {
        this.navigateToFn(interaction.anchor.x, interaction.anchor.y);
      } else {
        const angle = Math.atan2(playerPos.y - targetY, playerPos.x - targetX);
        const approachDist = interaction.interactionRadius * 0.7;
        this.navigateToFn(
          targetX + Math.cos(angle) * approachDist,
          targetY + Math.sin(angle) * approachDist,
        );
      }
    }
  }

  public checkProximity() {
    const playerPos = this.getPlayerPos();

    // Check pending navigation (player walked to a click interaction)
    if (this.pendingNavigation) {
      const pn = this.pendingNavigation;
      const targetX = pn.anchor?.x ?? (pn.x + pn.width / 2);
      const targetY = pn.anchor?.y ?? (pn.y + pn.height / 2);
      const dist = Phaser.Math.Distance.Between(playerPos.x, playerPos.y, targetX, targetY);
      if (dist <= pn.interactionRadius) {
        const obj = this.pendingNavigation;
        this.pendingNavigation = null;
        this.onInteractionClick?.({ object: obj, playerDistance: dist });
      }
    }

    // Check proximity-based interactions
    let closestProximity: InteractionObject | null = null;
    let closestDist = Infinity;

    for (const interaction of this.interactions) {
      if (interaction.triggerMode !== 'proximity') continue;

      const cx = interaction.x + interaction.width / 2;
      const cy = interaction.y + interaction.height / 2;

      // Check if player is inside the area OR within radius
      const inside =
        playerPos.x >= interaction.x &&
        playerPos.x <= interaction.x + interaction.width &&
        playerPos.y >= interaction.y &&
        playerPos.y <= interaction.y + interaction.height;

      const dist = inside ? 0 : Phaser.Math.Distance.Between(playerPos.x, playerPos.y, cx, cy);

      if ((inside || dist <= interaction.interactionRadius) && dist < closestDist) {
        closestDist = dist;
        closestProximity = interaction;
      }
    }

    // Handle proximity enter/exit
    if (closestProximity !== this.proximityActive) {
      if (this.proximityActive) {
        this.onProximityExit?.(this.proximityActive);
      }
      this.proximityActive = closestProximity;
      if (closestProximity) {
        this.onProximityEnter?.({ object: closestProximity, playerDistance: closestDist });
      }
    }

    // Check world zones
    this.checkWorldZones(playerPos);
  }

  private checkWorldZones(playerPos: { x: number; y: number }) {
    let insideZone: InteractionObject | null = null;
    for (const zone of this.zones) {
      if (
        playerPos.x >= zone.x &&
        playerPos.x <= zone.x + zone.width &&
        playerPos.y >= zone.y &&
        playerPos.y <= zone.y + zone.height
      ) {
        insideZone = zone;
        break;
      }
    }

    if (insideZone !== this.currentZone) {
      if (this.currentZone) {
        this.onZoneChange?.({
          zoneId: this.currentZone.properties.zoneId as string,
          zoneName: this.currentZone.name || (this.currentZone.properties.zoneId as string),
          zoneType: (this.currentZone.properties.zoneType as string) || 'unknown',
          entered: false,
        });
      }
      this.currentZone = insideZone;
      if (insideZone) {
        this.onZoneChange?.({
          zoneId: insideZone.properties.zoneId as string,
          zoneName: insideZone.name || (insideZone.properties.zoneId as string),
          zoneType: (insideZone.properties.zoneType as string) || 'unknown',
          entered: true,
        });
      }
    }
  }

  public confirmProximityInteraction() {
    if (!this.proximityActive) return;
    const playerPos = this.getPlayerPos();
    const cx = this.proximityActive.x + this.proximityActive.width / 2;
    const cy = this.proximityActive.y + this.proximityActive.height / 2;
    const dist = Phaser.Math.Distance.Between(playerPos.x, playerPos.y, cx, cy);
    this.onInteractionClick?.({ object: this.proximityActive, playerDistance: dist });
  }

  public cancelPendingNavigation() {
    this.pendingNavigation = null;
  }

  public getActiveProximity(): InteractionObject | null {
    return this.proximityActive;
  }

  public getInteractions(): InteractionObject[] {
    return this.interactions;
  }

  public getZones(): InteractionObject[] {
    return this.zones;
  }

  public getStats() {
    const counts: Record<string, number> = {};
    for (const i of this.interactions) {
      counts[i.category] = (counts[i.category] || 0) + 1;
    }
    counts['world_zone'] = this.zones.length;
    return counts;
  }

  public destroy() {
    this.interactiveZones.forEach(zone => zone.destroy());
    this.interactiveZones.clear();
    this.interactions = [];
    this.zones = [];
    this.anchors = [];
    this.proximityActive = null;
    this.currentZone = null;
    this.pendingNavigation = null;
  }

  public hitTestPointer(worldX: number, worldY: number): boolean {
    for (const interaction of this.interactions) {
      if (interaction.triggerMode !== 'click') continue;
      if (
        worldX >= interaction.x &&
        worldX <= interaction.x + interaction.width &&
        worldY >= interaction.y &&
        worldY <= interaction.y + interaction.height
      ) {
        return true;
      }
    }
    return false;
  }
}
