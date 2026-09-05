/**
 * Ordem dos snapshots de progresso no cliente.
 *
 * O servidor numera cada snapshot (`seq`, crescente por jogador). O mesmo
 * snapshot chega por dois caminhos — resposta HTTP do lote de atividade e
 * `progress_update` da sala — e re-tentativas idempotentes o repetem; sem
 * este filtro cada "+5 XP" aparecia em dobro e um snapshot atrasado podia
 * regredir energia/XP na tela.
 */
import type { ProgressSnapshot } from '../../shared/progress/EnergySkillsShapes';

/**
 * true quando `next` deve ser aplicado por cima de `previous`: mais novo, ou
 * sem como comparar (primeiro snapshot, servidor antigo sem `seq`, bancada).
 */
export function isNewerProgressSnapshot(previous: ProgressSnapshot | null, next: ProgressSnapshot): boolean {
  if (!previous) return true;
  if (typeof next.seq !== 'number' || typeof previous.seq !== 'number') return true;
  return next.seq > previous.seq;
}
