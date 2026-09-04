/**
 * Sinal síncrono "os slots vão mudar" — disparado pelo store logo ANTES de
 * aplicar uma troca de slots. Quem anima a reorganização (FLIP) usa o sinal
 * para medir as posições atuais dos itens enquanto o DOM ainda mostra a
 * arrumação antiga; depois do commit do React compara com as novas e anima
 * a diferença. Sem isso a medição "antes" ficaria defasada (janela movida,
 * rolagem) ou custaria uma leitura de layout por render.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onBeforeSlotsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyBeforeSlotsChange(): void {
  for (const listener of listeners) listener();
}
