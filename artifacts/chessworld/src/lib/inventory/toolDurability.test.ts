import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InventorySlotCell } from '../../components/game/inventory/InventorySlotCell';
import { toolDurabilityView } from './toolDurability';

// A config do Colyseus lê window.location na importação (modo dev local);
// aqui só interessam as regras puras e a marcação da célula.
vi.mock('../../config/colyseus', () => ({
  getColyseusWsUrl: () => '',
  getColyseusHttpUrl: () => '',
  isColyseusConfigured: () => false,
}));

const TOOL = 'gen:crafttools/pickaxe/stone';

describe('toolDurabilityView', () => {
  it('só ferramentas com máximo conhecido têm barra', () => {
    expect(toolDurabilityView('mineral:pedra', 10, 100)).toBeNull();
    expect(toolDurabilityView(TOOL, 10, undefined)).toBeNull();
    expect(toolDurabilityView(null, 10, 100)).toBeNull();
  });

  it('cheia (null) = 100% verde; degrada para âmbar e vermelho', () => {
    expect(toolDurabilityView(TOOL, null, 100)).toMatchObject({ remaining: 100, max: 100, ratio: 1, tone: 'good' });
    expect(toolDurabilityView(TOOL, 51, 100)?.tone).toBe('good');
    expect(toolDurabilityView(TOOL, 50, 100)?.tone).toBe('worn');
    expect(toolDurabilityView(TOOL, 21, 100)?.tone).toBe('worn');
    expect(toolDurabilityView(TOOL, 20, 100)?.tone).toBe('critical');
  });

  it('0 otimista (último golpe, quebra ainda não confirmada) mostra barra vazia, não cheia', () => {
    expect(toolDurabilityView(TOOL, 0, 100)).toMatchObject({ remaining: 0, ratio: 0, tone: 'critical' });
  });

  it('restante acima do máximo (admin baixou a durabilidade) é limitado', () => {
    expect(toolDurabilityView(TOOL, 500, 100)).toMatchObject({ remaining: 100, ratio: 1 });
  });
});

describe('InventorySlotCell — barra de durabilidade', () => {
  const render = (durability: ReturnType<typeof toolDurabilityView>, qty = 2) =>
    renderToStaticMarkup(createElement(InventorySlotCell, { index: 3, itemKey: TOOL, qty, catalog: null, durability }));

  it('desenha a barra com a largura proporcional, a cor do estado e o tooltip X/Y', () => {
    const html = render(toolDurabilityView(TOOL, 25, 100));
    expect(html).toContain('data-testid="durability-bar"');
    expect(html).toContain('data-tone="worn"');
    expect(html).toContain('width:25%');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('Durabilidade 25/100');
    expect(html).toContain('data-flip-key="gen:crafttools/pickaxe/stone"');
    expect(html).toContain('bottom-[7px]'); // badge de quantidade sobe para não cobrir a barra
  });

  it('sem durabilidade (não é ferramenta / coluna ausente) não há barra', () => {
    const html = render(null);
    expect(html).not.toContain('durability-bar');
    expect(html).toContain('bottom-0.5');
  });
});
