/**
 * Memória curta de requisições JÁ aplicadas (idempotência por chave).
 *
 * O cliente re-tenta lotes com o mesmo `requestId` quando a resposta se perde;
 * sem isto o servidor aplicaria o mesmo lote duas vezes. A memória guarda, por
 * chave, a promessa do resultado enquanto ela é válida:
 *   - repetição durante o voo → aguarda a MESMA promessa (não aplica de novo);
 *   - repetição após sucesso (dentro do TTL) → recebe o resultado lembrado;
 *   - falha (rejeição ou `isSuccess` falso) → esquecida, a repetição tenta de novo.
 * Em memória por processo: cobre a janela de retry do cliente (segundos a poucos
 * minutos); reiniciar o servidor perde a memória, o que é aceitável.
 */
export interface AppliedRequestsOptions<T> {
  ttlMs: number;
  maxEntries: number;
  isSuccess: (result: T) => boolean;
  now?: () => number;
}

export class AppliedRequests<T> {
  private readonly entries = new Map<string, { promise: Promise<T>; expiresAt: number }>();
  private readonly options: AppliedRequestsOptions<T>;
  private readonly now: () => number;

  constructor(options: AppliedRequestsOptions<T>) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.size;
  }

  /** Executa `apply` uma vez por chave válida; chave nula = sem idempotência. */
  run(key: string | null, apply: () => Promise<T>): Promise<T> {
    if (key === null) return apply();
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.promise;
    if (this.entries.size >= this.options.maxEntries) this.evict(now);
    const promise = apply().then(
      (result) => {
        if (!this.options.isSuccess(result)) this.entries.delete(key);
        return result;
      },
      (error: unknown) => {
        this.entries.delete(key);
        throw error;
      },
    );
    this.entries.set(key, { promise, expiresAt: now + this.options.ttlMs });
    return promise;
  }

  private evict(now: number): void {
    for (const [k, v] of this.entries) if (v.expiresAt <= now) this.entries.delete(k);
    // Ainda cheio (tudo recente): descarta o mais antigo — Map preserva a ordem de inserção.
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
