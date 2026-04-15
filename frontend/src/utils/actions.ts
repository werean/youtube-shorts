/**
 * Ação genérica reutilizável para executar operações assíncronas com loading e erro
 */

export interface ActionState {
  busy: boolean;
  error?: string;
}

type SetActionFn = (state: ActionState) => void;

export async function runAction<T>(
  fn: () => Promise<T>,
  setAction: SetActionFn,
  onSuccess?: (value: T) => void,
): Promise<T | void> {
  console.log(`\n[Action] Executando...`);
  setAction({ busy: true });
  try {
    const result = await fn();
    console.log(`[Action] Completada com sucesso`);
    onSuccess?.(result);
    setAction({ busy: false });
    return result;
  } catch (error: any) {
    console.error(`[Action] Erro:`, error);
    const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
    setAction({ busy: false, error: errorMessage });
  }
}
